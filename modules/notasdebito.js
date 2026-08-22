const api = require('./api');

const NotasDebitoModule = {
    facturaSeleccionada: null,
    motivos: [],
    inicializado: false,

    init() {
        if (this.inicializado) { this.cargarHistorial(); return; }
        this.inicializado = true;
        this.cargarHistorial();
    },

    getSedeId() {
        const selector = document.getElementById('globalSedeSelector');
        if (selector) return selector.value;
        const user = JSON.parse(localStorage.getItem('user'));
        return localStorage.getItem('currentSedeId') || (user ? user.SedeID : 1);
    },

    async buscarFacturas() {
        const buscar = document.getElementById('ndBuscarFactura').value.trim();
        const cont = document.getElementById('ndResultadosFacturas');
        cont.innerHTML = '<p style="text-align:center; opacity:0.6; font-size:0.8rem;">Buscando...</p>';
        try {
            const res = await api.get(`/notasdebito/facturas/${this.getSedeId()}`, { params: { buscar } });
            const facturas = res.data.facturas || [];
            if (!facturas.length) {
                cont.innerHTML = '<p style="text-align:center; opacity:0.6; font-size:0.8rem;">Sin resultados.</p>';
                return;
            }
            cont.innerHTML = facturas.map(f => `
                <div style="padding:10px 12px; background:#f1f3f5; border-radius:12px; margin-bottom:8px; cursor:pointer;"
                     onclick="NotasDebitoModule.seleccionarFactura(${f.FacturaID})">
                    <strong style="color:#2c3e50; font-size:0.8rem;">Secuencial ${f.Secuencial}</strong>
                    <div style="font-size:0.7rem; color:#718096;">${f.FechaEmision} — ${f.EstadoSRI}</div>
                </div>
            `).join('');
        } catch (err) {
            cont.innerHTML = '<p style="text-align:center; color:#e74c3c; font-size:0.8rem;">Error al buscar.</p>';
        }
    },

    async seleccionarFactura(facturaId) {
        try {
            Swal.fire({ title: 'Cargando factura...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const res = await api.get(`/notasdebito/factura/${facturaId}/detalle`);
            Swal.close();

            const { factura, cliente } = res.data;
            this.facturaSeleccionada = { ...factura, cliente };
            this.motivos = [];

            document.getElementById('ndPanelSeleccion').style.display = '';
            document.getElementById('ndClienteNombre').textContent = cliente.Nombre;
            document.getElementById('ndSecuencialFactura').textContent = factura.Secuencial;

            document.getElementById('ndSinFactura').classList.add('hidden');
            document.getElementById('ndFormMotivo').classList.remove('hidden');
            document.getElementById('ndTablaMotivos').classList.remove('hidden');
            document.getElementById('ndTotalesBox').classList.remove('hidden');
            document.getElementById('ndBtnEmitir').classList.remove('hidden');

            this.renderMotivos();
        } catch (err) {
            Swal.fire('Error', err.response?.data?.error || 'No se pudo cargar la factura.', 'error');
        }
    },

    agregarMotivo() {
        const razon = document.getElementById('ndDetRazon').value.trim();
        const valor = parseFloat(document.getElementById('ndDetValor').value) || 0;
        if (!razon) return Swal.fire('Falta la razón', 'Indique la razón del recargo.', 'warning');
        if (valor <= 0) return Swal.fire('Valor inválido', 'El valor debe ser mayor a 0.', 'warning');

        this.motivos.push({ Razon: razon, Valor: valor });
        document.getElementById('ndDetRazon').value = '';
        document.getElementById('ndDetValor').value = '';
        this.renderMotivos();
    },

    quitarMotivo(index) {
        this.motivos.splice(index, 1);
        this.renderMotivos();
    },

    renderMotivos() {
        const body = document.getElementById('ndTablaMotivosBody');
        if (!this.motivos.length) {
            body.innerHTML = '<tr><td colspan="3" style="text-align:center; opacity:0.5;">Sin motivos agregados</td></tr>';
        } else {
            body.innerHTML = this.motivos.map((m, i) => `
                <tr>
                    <td>${m.Razon}</td>
                    <td>$${m.Valor.toFixed(2)}</td>
                    <td><button type="button" class="btn-neo btn-danger" style="padding:8px 12px;" onclick="NotasDebitoModule.quitarMotivo(${i})"><i class="fas fa-trash"></i></button></td>
                </tr>
            `).join('');
        }
        const total = this.motivos.reduce((acc, m) => acc + m.Valor, 0);
        document.getElementById('ndTotalGeneral').textContent = total.toFixed(2);
    },

    async emitir() {
        if (!this.facturaSeleccionada) return;
        if (!this.motivos.length) return Swal.fire('Sin motivos', 'Debe agregar al menos un motivo de recargo.', 'warning');

        const user = JSON.parse(localStorage.getItem('user'));
        const payload = {
            FacturaID: this.facturaSeleccionada.FacturaID,
            UsuarioID: user ? user.UsuarioID : 1,
            SedeID: this.getSedeId(),
            FormaPago: document.getElementById('ndFormaPago').value,
            Motivos: this.motivos
        };

        try {
            Swal.fire({ title: 'Generando Nota de Débito...', text: 'Firmando XML e interactuando con SRI...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const res = await api.post('/notasdebito/emitir', payload);
            if (res.data.success) {
                await Swal.fire({ title: '¡NOTA DE DÉBITO EMITIDA!', text: `SRI: ${res.data.estadoSRI} | Acceso: ${res.data.claveAcceso}`, icon: 'success', confirmButtonColor: 'var(--hotel-blue)' });
                this.resetFormulario();
                await this.cargarHistorial();
            }
        } catch (err) {
            Swal.fire({ icon: 'error', title: 'No se pudo emitir', text: err.response?.data?.error || 'Error desconocido' });
        }
    },

    resetFormulario() {
        this.facturaSeleccionada = null;
        this.motivos = [];
        document.getElementById('ndPanelSeleccion').style.display = 'none';
        document.getElementById('ndSinFactura').classList.remove('hidden');
        document.getElementById('ndFormMotivo').classList.add('hidden');
        document.getElementById('ndTablaMotivos').classList.add('hidden');
        document.getElementById('ndTotalesBox').classList.add('hidden');
        document.getElementById('ndBtnEmitir').classList.add('hidden');
        document.getElementById('ndResultadosFacturas').innerHTML = '';
        document.getElementById('ndBuscarFactura').value = '';
    },

    async cargarHistorial() {
        try {
            const res = await api.get(`/notasdebito/historial/${this.getSedeId()}`);
            this.historialCache = res.data || [];
            this.renderHistorial();
        } catch (err) {
            console.error('Error cargando historial de ND:', err);
        }
    },

    renderHistorial() {
        const body = document.getElementById('ndTablaHistorialBody');
        if (!body) return;
        const buscar = (document.getElementById('ndHistorialBuscar')?.value || '').trim().toLowerCase();
        const base = this.historialCache || [];
        const lista = buscar
            ? base.filter(nd => (nd.ClienteNombre || '').toLowerCase().includes(buscar) || (nd.ClienteDocumento || '').toLowerCase().includes(buscar) || (nd.Secuencial || '').toLowerCase().includes(buscar))
            : base;

        if (!lista.length) {
            body.innerHTML = `<tr><td colspan="6" style="text-align:center; opacity:0.5;">${buscar ? `Sin resultados para "${buscar}".` : 'Sin Notas de Débito emitidas.'}</td></tr>`;
            return;
        }
        body.innerHTML = lista.map(nd => {
            const badgeClass = nd.EstadoSRI === 'AUTORIZADO' ? 'badge-autorizado'
                : nd.EstadoSRI === 'FIRMADO' ? 'badge-firmado'
                : nd.EstadoSRI === 'RECHAZADO' ? 'badge-rechazado' : 'badge-pendiente';
            return `
                <tr>
                    <td>${nd.Secuencial}</td>
                    <td>${nd.ClienteNombre}</td>
                    <td>${nd.SecuencialFacturaOriginal}</td>
                    <td>$${parseFloat(nd.Total).toFixed(2)}</td>
                    <td><span class="badge-sri ${badgeClass}">${nd.EstadoSRI || 'PENDIENTE'}</span></td>
                    <td>
                        <button class="btn-neo" style="padding:8px 12px;" title="Ver RIDE" onclick="NotasDebitoModule.verRIDE(${nd.NotaDebitoID})"><i class="fas fa-file-pdf"></i></button>
                        <button class="btn-neo" style="padding:8px 12px;" title="Enviar correo" onclick="NotasDebitoModule.enviarCorreo(${nd.NotaDebitoID})"><i class="fas fa-envelope"></i></button>
                    </td>
                </tr>
            `;
        }).join('');
    },

    async verRIDE(notaDebitoId) {
        try {
            const res = await api.get(`/notasdebito/documento/ride/${notaDebitoId}`);
            if (res.data.success) {
                const base = api.defaults.baseURL.replace(/\/api\/?$/, '');
                window.open(`${base}${res.data.pdfUrl}`, '_blank');
            }
        } catch (err) {
            Swal.fire('Error', err.response?.data?.error || 'No se pudo generar el RIDE.', 'error');
        }
    },

    async enviarCorreo(notaDebitoId) {
        const { value: correo } = await Swal.fire({
            title: 'Enviar Nota de Débito',
            input: 'email',
            inputPlaceholder: 'correo@ejemplo.com',
            showCancelButton: true,
            confirmButtonText: 'Enviar'
        });
        if (!correo) return;
        try {
            Swal.fire({ title: 'Enviando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            await api.post('/notasdebito/documento/enviar-correo', { notaDebitoId, correoDestino: correo });
            await Swal.fire('Enviado', 'El correo fue enviado correctamente.', 'success');
        } catch (err) {
            Swal.fire('Error', err.response?.data?.error || 'No se pudo enviar el correo.', 'error');
        }
    }
};

module.exports = NotasDebitoModule;
