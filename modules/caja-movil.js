// modules/caja-movil.js
// Caja completa para el celular: estado, abrir turno, ingresos/egresos (con
// voucher en transferencia/tarjeta) y cuadre/cierre con desglose físico.
// Reutiliza los mismos endpoints del escritorio (cajaController). Backend intacto.
const api = require('./api');

// Denominaciones (USD Ecuador) iguales a las del cuadre del escritorio
const DENOMINACIONES = [100, 50, 20, 10, 5, 1, 0.5, 0.25, 0.10, 0.05, 0.01];

const CajaMovilModule = {
    cajaActiva: null,
    saldoEsperado: 0,
    montoDeclarado: 0,
    desglose: {},
    _voucherFile: null,
    tipoMovActual: 'Ingreso',

    async init() {
        console.log("💵 Módulo Caja Móvil iniciado...");
        await this.checkEstado();
        window.CajaMovilModule = this;
    },

    getUser() { return JSON.parse(localStorage.getItem('user')); },
    getSedeId() {
        const u = this.getUser();
        return localStorage.getItem('currentSedeId') || (u ? u.SedeID : 1);
    },
    money(n) { return '$' + (parseFloat(n) || 0).toFixed(2); },

    // ==========================================
    // ESTADO DEL TURNO
    // ==========================================
    async checkEstado() {
        const user = this.getUser();
        try {
            const res = await api.get(`/caja/estado/${user.UsuarioID}/${this.getSedeId()}`);
            const abierta = res.data.abierta;
            this.cajaActiva = abierta ? res.data.caja : null;

            const secAbierta = document.getElementById('caja-abierta');
            const secCerrada = document.getElementById('caja-cerrada');
            const pill = document.getElementById('caja-status-pill');

            if (abierta) {
                if (secAbierta) secAbierta.style.display = 'block';
                if (secCerrada) secCerrada.style.display = 'none';
                if (pill) { pill.textContent = `TURNO ABIERTO · #${this.cajaActiva.CajaID}`; pill.style.color = '#27ae60'; }

                const apEl = document.getElementById('caja-apertura');
                if (apEl) apEl.textContent = this.money(this.cajaActiva.MontoApertura);

                await this.cargarMovimientos();
            } else {
                if (secAbierta) secAbierta.style.display = 'none';
                if (secCerrada) secCerrada.style.display = 'block';
                if (pill) { pill.textContent = 'TURNO CERRADO'; pill.style.color = '#e74c3c'; }
            }
        } catch (err) {
            console.error("Error verificando caja:", err.response?.data || err.message);
            if (window.Toast) window.Toast.fire({ icon: 'error', title: 'No se pudo verificar la caja' });
        }
    },

    async cargarMovimientos() {
        if (!this.cajaActiva) return;
        try {
            const res = await api.get(`/caja/detalle/${this.cajaActiva.CajaID}`);
            const movs = res.data || [];

            // Calcular esperado en vivo para mostrarlo en la tarjeta
            let inEfe = 0, outEfe = 0, inTransf = 0, inTarjeta = 0;
            movs.forEach(m => {
                const monto = parseFloat(m.Monto);
                const metodo = parseInt(m.MetodoID) || 1;
                if (metodo === 1) { if (m.TipoMovimiento === 'Ingreso') inEfe += monto; else outEfe += monto; }
                else if (metodo === 2 && m.TipoMovimiento === 'Ingreso') inTransf += monto;
                else if (metodo === 3 && m.TipoMovimiento === 'Ingreso') inTarjeta += monto;
            });
            const apertura = parseFloat(this.cajaActiva.MontoApertura);
            const esperado = (apertura + inEfe + inTransf + inTarjeta) - outEfe;
            const espEl = document.getElementById('caja-esperado');
            if (espEl) espEl.textContent = this.money(esperado);

            this.renderMovimientos(movs);
        } catch (e) { console.error("Error cargando movimientos:", e); }
    },

    renderMovimientos(movs) {
        const cont = document.getElementById('caja-lista-mov');
        if (!cont) return;
        if (!movs || movs.length === 0) {
            cont.innerHTML = `<p style="text-align:center; opacity:0.5; padding:20px;">Sin movimientos en este turno</p>`;
            return;
        }
        cont.innerHTML = movs.slice().reverse().map(m => {
            const esIngreso = m.TipoMovimiento === 'Ingreso';
            return `
                <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:12px 14px; margin-bottom:8px;
                            background:#e0e0e4; border-radius:14px; box-shadow:inset 3px 3px 6px #bebebe, inset -3px -3px 6px #ffffff;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-size:0.8rem; font-weight:800; color:#1a365d;">${m.Metodo || 'Efectivo'} ${m.FechaMovFmt ? '· ' + m.FechaMovFmt : ''}</div>
                        <div style="font-size:0.68rem; color:#718096; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${m.Observacion || '—'}</div>
                    </div>
                    <div style="font-weight:900; font-size:1rem; color:${esIngreso ? '#27ae60' : '#e74c3c'};">
                        ${esIngreso ? '+' : '-'}${this.money(m.Monto)}
                    </div>
                </div>`;
        }).join('');
    },

    // ==========================================
    // ABRIR TURNO
    // ==========================================
    abrirModalApertura() {
        const inp = document.getElementById('mov-apertura-monto');
        if (inp) inp.value = '';
        this.mostrar('modal-caja-apertura');
        setTimeout(() => inp && inp.focus(), 100);
    },

    async confirmarApertura() {
        const monto = parseFloat(document.getElementById('mov-apertura-monto').value);
        if (isNaN(monto) || monto < 0) {
            return window.Toast.fire({ icon: 'warning', title: 'Ingrese un monto válido' });
        }
        try {
            const user = this.getUser();
            const res = await api.post('/caja/abrir', { usuarioId: user.UsuarioID, sedeId: this.getSedeId(), montoApertura: monto });
            if (res.data.success) {
                window.Toast.fire({ icon: 'success', title: 'TURNO INICIADO' });
                this.cerrarModales();
                await this.checkEstado();
            } else {
                Swal.fire('Atención', res.data.message || 'No se pudo abrir', 'warning');
            }
        } catch (err) {
            Swal.fire('Error', err.response?.data?.message || 'No se pudo abrir la caja', 'error');
        }
    },

    // ==========================================
    // MOVIMIENTO (Ingreso / Egreso)
    // ==========================================
    abrirModalMovimiento(tipo) {
        this.tipoMovActual = tipo; // 'Ingreso' | 'Egreso'
        this._voucherFile = null;

        document.getElementById('mov-titulo').textContent = tipo === 'Ingreso' ? 'REGISTRAR INGRESO' : 'REGISTRAR EGRESO';
        const btn = document.getElementById('mov-confirmar-btn');
        if (btn) btn.style.background = tipo === 'Ingreso' ? '#27ae60' : '#e74c3c';

        ['mov-monto', 'mov-ref', 'mov-obs'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        document.getElementById('mov-metodo').value = '1';
        this.gestionarVoucher();
        this.mostrar('modal-caja-movimiento');
    },

    gestionarVoucher() {
        const metodo = document.getElementById('mov-metodo').value;
        const box = document.getElementById('mov-box-voucher');
        const requiere = (metodo === '2' || metodo === '3');
        if (box) box.style.display = requiere ? 'block' : 'none';
        if (!requiere) {
            this._voucherFile = null;
            const f = document.getElementById('mov-voucher'); if (f) f.value = '';
            const pv = document.getElementById('mov-voucher-preview'); if (pv) pv.style.display = 'none';
            const bt = document.getElementById('mov-voucher-btn'); if (bt) bt.innerHTML = '<i class="fas fa-camera"></i> TOMAR / CARGAR FOTO';
        }
    },

    onVoucherSeleccionado(input) {
        const file = input.files[0];
        this._voucherFile = file || null;
        if (file) {
            const pv = document.getElementById('mov-voucher-preview');
            if (pv) { pv.src = URL.createObjectURL(file); pv.style.display = 'block'; }
            const bt = document.getElementById('mov-voucher-btn');
            if (bt) bt.innerHTML = '<i class="fas fa-check"></i> COMPROBANTE LISTO';
        }
    },

    async confirmarMovimiento() {
        const monto = parseFloat(document.getElementById('mov-monto').value);
        const metodo = document.getElementById('mov-metodo').value;
        if (isNaN(monto) || monto <= 0) {
            return window.Toast.fire({ icon: 'warning', title: 'Ingrese un monto válido' });
        }
        if ((metodo === '2' || metodo === '3') && !this._voucherFile) {
            return window.Toast.fire({ icon: 'warning', title: 'Adjunte el comprobante' });
        }

        try {
            const fd = new FormData();
            fd.append('cajaId', this.cajaActiva.CajaID);
            fd.append('tipo', this.tipoMovActual);
            fd.append('metodoId', metodo);
            fd.append('monto', monto);
            fd.append('ref', document.getElementById('mov-ref').value || '');
            fd.append('obs', document.getElementById('mov-obs').value || '');
            if (this._voucherFile) fd.append('voucher', this._voucherFile);

            await api.post('/caja/movimiento', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            window.Toast.fire({ icon: 'success', title: 'MOVIMIENTO REGISTRADO' });
            this._voucherFile = null;
            this.cerrarModales();
            await this.checkEstado();
        } catch (err) {
            Swal.fire('Error', err.response?.data || 'No se pudo registrar el movimiento', 'error');
        }
    },

    // ==========================================
    // CUADRE Y CIERRE
    // ==========================================
    async abrirModalCierre() {
        if (!this.cajaActiva) return;
        try {
            const res = await api.get(`/caja/detalle/${this.cajaActiva.CajaID}`);
            const inicial = parseFloat(this.cajaActiva.MontoApertura);
            let inEfe = 0, outEfe = 0, inTransf = 0, inTarjeta = 0;

            (res.data || []).forEach(m => {
                const monto = parseFloat(m.Monto);
                const metodo = parseInt(m.MetodoID) || 1;
                if (metodo === 1) { if (m.TipoMovimiento === 'Ingreso') inEfe += monto; else outEfe += monto; }
                else if (metodo === 2 && m.TipoMovimiento === 'Ingreso') inTransf += monto;
                else if (metodo === 3 && m.TipoMovimiento === 'Ingreso') inTarjeta += monto;
            });

            this.saldoEsperado = parseFloat(((inicial + inEfe + inTransf + inTarjeta) - outEfe).toFixed(2));

            // Resumen del sistema
            document.getElementById('cie-inicial').textContent = this.money(inicial);
            document.getElementById('cie-ingresos-efe').textContent = '+' + this.money(inEfe);
            document.getElementById('cie-egresos-efe').textContent = '-' + this.money(outEfe);
            document.getElementById('cie-transf').textContent = this.money(inTransf);
            document.getElementById('cie-tarjetas').textContent = this.money(inTarjeta);
            document.getElementById('cie-esperado').textContent = this.money(this.saldoEsperado);

            // Construir grid de denominaciones
            const grid = document.getElementById('cie-denoms');
            grid.innerHTML = DENOMINACIONES.map(v => {
                const etiqueta = v >= 1 ? `$${v}` : `¢${Math.round(v * 100)}`;
                return `
                    <div style="display:flex; flex-direction:column;">
                        <label style="font-size:0.6rem; font-weight:900; color:#718096; margin-bottom:4px; text-align:center;">${etiqueta}</label>
                        <input type="number" min="0" inputmode="numeric" data-valor="${v}" class="cie-denom-input"
                            placeholder="0" style="width:100%; border:none; border-radius:10px; padding:10px 6px; text-align:center;
                            font-weight:900; color:#1a365d; background:#e0e0e4; outline:none;
                            box-shadow:inset 3px 3px 6px #bebebe, inset -3px -3px 6px #ffffff;">
                    </div>`;
            }).join('');

            document.getElementById('cie-declara-transf').value = '';
            document.getElementById('cie-declara-tarjeta').value = '';
            document.getElementById('cie-obs').value = '';

            // Listeners de recálculo
            document.querySelectorAll('.cie-denom-input, .cie-declara').forEach(inp => {
                inp.addEventListener('input', () => this.recalcularCuadre());
            });

            this.recalcularCuadre();
            this.mostrar('modal-caja-cierre');
        } catch (err) {
            Swal.fire('Error', 'No se pudo preparar el cierre', 'error');
        }
    },

    recalcularCuadre() {
        let totalEfectivo = 0;
        const desglose = {};

        document.querySelectorAll('.cie-denom-input').forEach(inp => {
            const cantidad = parseInt(inp.value) || 0;
            const valor = parseFloat(inp.dataset.valor);
            if (cantidad > 0) { totalEfectivo += cantidad * valor; desglose[valor] = cantidad; }
        });

        const valTransf = parseFloat(document.getElementById('cie-declara-transf').value) || 0;
        const valTarj = parseFloat(document.getElementById('cie-declara-tarjeta').value) || 0;
        desglose['Transferencias'] = valTransf;
        desglose['Tarjetas'] = valTarj;

        const totalContado = parseFloat((totalEfectivo + valTransf + valTarj).toFixed(2));
        const diferencia = parseFloat((totalContado - this.saldoEsperado).toFixed(2));

        this.montoDeclarado = totalContado;
        this.desglose = desglose;

        document.getElementById('cie-total-fisico').textContent = this.money(totalContado);
        const elDif = document.getElementById('cie-diferencia');
        const card = document.getElementById('cie-card-diferencia');
        elDif.textContent = this.money(diferencia);
        let color = '#f39c12';
        if (diferencia === 0) color = '#27ae60';
        else if (diferencia < 0) color = '#e74c3c';
        elDif.style.color = color;
        if (card) card.style.borderColor = color;
    },

    async confirmarCierre() {
        const diferencia = parseFloat((this.montoDeclarado - this.saldoEsperado).toFixed(2));
        const obs = document.getElementById('cie-obs').value.trim();

        if (diferencia !== 0 && obs === '') {
            return Swal.fire({ icon: 'warning', title: 'Justifica el desfase', text: 'Hay diferencia en el cuadre. Escribe una observación antes de cerrar.' });
        }

        const confirm = await Swal.fire({
            title: '¿CERRAR TURNO?',
            html: `Esperado: <b>${this.money(this.saldoEsperado)}</b><br>Contado: <b>${this.money(this.montoDeclarado)}</b><br>Diferencia: <b style="color:${diferencia === 0 ? '#27ae60' : '#e74c3c'}">${this.money(diferencia)}</b>`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'SÍ, CERRAR',
            cancelButtonText: 'CANCELAR',
            confirmButtonColor: '#1a365d'
        });
        if (!confirm.isConfirmed) return;

        try {
            const res = await api.post('/caja/cerrar', {
                cajaId: this.cajaActiva.CajaID,
                montoDeclarado: parseFloat(this.montoDeclarado.toFixed(2)),
                obs: obs,
                desgloseFisico: JSON.stringify(this.desglose)
            });
            const resDif = parseFloat(res.data.diferencia);
            await Swal.fire({
                title: resDif === 0 ? '¡CAJA CUADRADA!' : 'TURNO CERRADO CON DESFASE',
                text: 'El turno finalizó y se envió a auditoría.',
                icon: resDif === 0 ? 'success' : 'warning',
                confirmButtonColor: '#1a365d'
            });
            this.cerrarModales();
            await this.checkEstado();
        } catch (err) {
            Swal.fire('Error', err.response?.data || 'No se pudo cerrar la caja', 'error');
        }
    },

    // ==========================================
    // MODALES
    // ==========================================
    mostrar(id) { const el = document.getElementById(id); if (el) el.style.display = 'flex'; },
    cerrarModales() {
        ['modal-caja-apertura', 'modal-caja-movimiento', 'modal-caja-cierre'].forEach(id => {
            const el = document.getElementById(id); if (el) el.style.display = 'none';
        });
    }
};

module.exports = CajaMovilModule;
