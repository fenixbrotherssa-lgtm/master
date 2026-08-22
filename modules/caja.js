const api = require('./api');
const { generarYAbrirComprobante, adjuntarComprobante: subirComprobante } = require('./comprobanteEgresoPrint');

const CajaModule = {
    cajaActiva: null,
    modo: null,

    saldoEsperadoActual: 0,
    montoDeclaradoActual: 0,
    desgloseActual: {},

    // Pasarela
    _pasarelaHabilitada: false,
    _pasClt: null,   // clientTransactionId activo
    _pasUrl: null,   // URL de pago activa

    async init() {
        console.log("🚀 Modulo Caja: Arqueo Global (Efectivo + Transferencias + Tarjetas)...");
        await this.checkEstado();
        this._verificarPasarela();
        
        // HISTORIAL: 7 días por defecto para que no desaparezcan
        const hoy = new Date();
        const haceUnaSemana = new Date();
        haceUnaSemana.setDate(hoy.getDate() - 7);

        const hoyStr = hoy.toISOString().split('T')[0];
        const inicioStr = haceUnaSemana.toISOString().split('T')[0];

        if(document.getElementById('f-inicio')) document.getElementById('f-inicio').value = inicioStr;
        if(document.getElementById('f-fin')) document.getElementById('f-fin').value = hoyStr;

        this.setupEventListeners();
        window.CajaModule = this;
    },

    switchTab(tab) {
        const secOp = document.getElementById('section-operacion');
        const secHist = document.getElementById('section-historial');
        const btnOp = document.getElementById('tab-operacion');
        const btnHist = document.getElementById('tab-historial');

        if(tab === 'operacion') {
            if(secOp) secOp.classList.remove('hidden');
            if(secHist) secHist.classList.add('hidden');
            if(btnOp) btnOp.classList.add('active');
            if(btnHist) btnHist.classList.remove('active');
        } else {
            if(secOp) secOp.classList.add('hidden');
            if(secHist) secHist.classList.remove('hidden');
            if(btnOp) btnOp.classList.remove('active');
            if(btnHist) btnHist.classList.add('active');
            this.listarHistorial(); 
        }
    },

    async checkEstado() {
        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const sedeId = localStorage.getItem('currentSedeId') || user.SedeID;
            
            const res = await api.get(`/caja/estado/${user.UsuarioID}/${sedeId}`);
            
            const btnAbrir = document.getElementById('btn-abrir-caja');
            const btnCerrar = document.getElementById('btn-cerrar-caja');
            const viewActiva = document.getElementById('caja-activa-view');
            const viewCerrada = document.getElementById('caja-cerrada-view');
            const labelStatus = document.getElementById('status-caja-label');

            if (res.data.abierta) {
                this.cajaActiva = res.data.caja;
                if(btnAbrir) btnAbrir.classList.add('hidden');
                if(btnCerrar) btnCerrar.classList.remove('hidden');
                if(viewActiva) viewActiva.classList.remove('hidden');
                if(viewCerrada) viewCerrada.classList.add('hidden');
                
                if(labelStatus) labelStatus.innerHTML = `<i class="fas fa-circle" style="color:var(--hotel-success)"></i> TURNO ABIERTO - #CAJA: ${this.cajaActiva.CajaID}`;
                
                await this.cargarDatosDashboard();

                // Auto-refresco en vivo: si el dueño anula un movimiento desde afuera,
                // la pantalla del cajero se actualiza sola (sin tener que refrescar a mano).
                if (this._cajaPoll) clearInterval(this._cajaPoll);
                this._cajaPoll = setInterval(() => {
                    if (this.cajaActiva) this.cargarDatosDashboard();
                }, 12000);
            } else {
                this.cajaActiva = null;
                if (this._cajaPoll) { clearInterval(this._cajaPoll); this._cajaPoll = null; }
                if(btnAbrir) btnAbrir.classList.remove('hidden');
                if(btnCerrar) btnCerrar.classList.add('hidden');
                if(viewActiva) viewActiva.classList.add('hidden');
                if(viewCerrada) viewCerrada.classList.remove('hidden');
                
                if(labelStatus) labelStatus.innerHTML = `<i class="fas fa-circle" style="color:var(--hotel-danger)"></i> TURNO CERRADO`;
            }
        } catch (err) {
            console.error("❌ Fallo en checkEstado:", err);
            window.Toast.fire({ icon: 'error', title: 'ERROR DE CONEXIÓN CON CAJA' });
        }
    },

    async cargarDatosDashboard() {
        if (!this.cajaActiva) return;
        try {
            const res = await api.get(`/caja/detalle/${this.cajaActiva.CajaID}`);
            const movimientos = res.data;

            let inEfe = 0, outEfe = 0;
            let inTransf = 0, inTarjeta = 0;
            
            movimientos.forEach(m => {
                const monto = parseFloat(m.Monto);
                const metodo = parseInt(m.MetodoID) || 1; 
                
                if (metodo === 1) { 
                    if (m.TipoMovimiento === 'Ingreso') inEfe += monto;
                    else outEfe += monto;
                } 
                else if (metodo === 2 && m.TipoMovimiento === 'Ingreso') { 
                    inTransf += monto;
                }
                else if (metodo === 3 && m.TipoMovimiento === 'Ingreso') { 
                    inTarjeta += monto;
                }
            });

            const inicial = parseFloat(this.cajaActiva.MontoApertura);
            const saldoEfectivo = (inicial + inEfe) - outEfe;

            try {
                document.getElementById('m-inicial').textContent = `$${inicial.toFixed(2)}`;
                document.getElementById('m-efectivo-ventas').textContent = `$${inEfe.toFixed(2)}`;
                document.getElementById('m-transferencias').textContent = `$${inTransf.toFixed(2)}`;
                document.getElementById('m-tarjetas').textContent = `$${inTarjeta.toFixed(2)}`;
                document.getElementById('m-saldo-efectivo').textContent = `$${saldoEfectivo.toFixed(2)}`;
                document.getElementById('m-total-bruto').textContent = `$${(saldoEfectivo + inTransf + inTarjeta).toFixed(2)}`;
            } catch(e) {}

            this.renderTablaMovimientos(movimientos);
        } catch (err) { console.error("❌ Error cargando dashboard:", err); }
    },

    renderTablaMovimientos(movimientos) {
        const body = document.getElementById('tablaMovimientosBody');
        if (!body) return;
        this.movimientosActuales = movimientos;

        const serverUrl = api.defaults.baseURL.split('/api')[0];

        body.innerHTML = movimientos.map(m => {
            const voucherHtml = m.ImagenVoucherPath 
                ? `<a href="${serverUrl}/uploads/${m.ImagenVoucherPath}" target="_blank" style="color:var(--hotel-blue); margin-left:10px;" title="Ver Voucher"><i class="fas fa-file-invoice-dollar"></i></a>`
                : '';

            // Detectar si el movimiento es un CHECK-IN (para ofrecer anular TODO el check-in)
            const mCheckin = (m.Observacion || '').match(/CHECK-IN \| Folio #(\d+)/);
            const recIdMov = mCheckin ? mCheckin[1] : 0;

            // Botón de eliminación: bloqueado si el movimiento pertenece a un cierre maestro auditado
            const btnAnular = (m.CierreMaestroID !== null && m.CierreMaestroID !== undefined)
                ? `<span style="font-size:0.65rem; font-weight:bold; color:#718096;" title="Periodo cerrado"><i class="fas fa-lock"></i></span>`
                : `<button type="button" class="btn-neo" style="padding:6px 10px; color:var(--hotel-danger);" title="${recIdMov ? 'Anular check-in completo' : 'Eliminar movimiento mal elaborado'}" onclick="CajaModule.solicitarAnulacion(${m.MovimientoID}, ${recIdMov})"><i class="fas fa-trash-alt"></i></button>`;

            const botonesEgreso = m.TipoMovimiento === 'Egreso' ? `
                <button type="button" class="btn-neo" style="padding:6px 10px; color:var(--hotel-blue);" title="Generar comprobante de egreso (PDF, se guarda)" onclick="CajaModule.generarComprobante(${m.MovimientoID})"><i class="fas fa-file-pdf"></i></button>
                <button type="button" class="btn-neo" style="padding:6px 10px; color:#8e44ad;" title="Adjuntar factura real u otro respaldo" onclick="CajaModule.adjuntarComprobante(${m.MovimientoID})"><i class="fas fa-paperclip"></i></button>
            ` : '';

            return `
            <tr>
                <td style="font-size:0.75rem; font-weight:700; color:#718096;">
                    ${m.FechaMovFmt || new Date(m.FechaMovimiento).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </td>
                <td><span class="status-pill ${m.TipoMovimiento === 'Ingreso' ? 'active' : 'inactive'}">${m.TipoMovimiento.toUpperCase()}</span></td>
                <td><span class="badge-metodo">${m.Metodo || 'EFECTIVO'}</span></td>
                <td>
                    <div style="font-size:0.85rem; font-weight:800; color:var(--hotel-blue);">
                        ${m.ReferenciaVoucher || 'SIN REF'} ${voucherHtml}
                    </div>
                    <small style="color:#718096;">${m.Observacion || ''}</small>
                </td>
                <td style="text-align:right; font-weight:900; font-size:1.1rem; color: ${m.TipoMovimiento === 'Ingreso' ? 'var(--hotel-success)' : 'var(--hotel-danger)'}">
                    ${m.TipoMovimiento === 'Ingreso' ? '+' : '-'}$${parseFloat(m.Monto).toFixed(2)}
                </td>
                <td style="text-align:center; display:flex; gap:5px; justify-content:center; flex-wrap:wrap;">${botonesEgreso} ${btnAnular}</td>
            </tr>
        `}).join('');
    },

    generarComprobante(movimientoId) {
        generarYAbrirComprobante(movimientoId, this.cajaActiva?.SedeNombre || document.title)
            .then(() => this.cargarDatosDashboard());
    },

    adjuntarComprobante(movimientoId) {
        subirComprobante(movimientoId, () => this.cargarDatosDashboard());
    },

    abrirModalApertura() {
        this.modo = 'APERTURA';
        this.prepararModal("APERTURA DE TURNO", 'sec-apertura', false);
    },

    abrirModalMovimiento() {
        this.modo = 'MOVIMIENTO';
        this.prepararModal("NUEVO MOVIMIENTO", 'sec-movimiento', false);
        this.gestionarCamposVoucher(); 
    },

    gestionarCamposVoucher() {
        const metodoSelect = document.getElementById('metodoMov');
        const tipoSelect = document.getElementById('tipoMov');
        const fileContainer = document.getElementById('container-voucher-file');
        const hintEgreso = document.getElementById('voucherHintEgreso');
        if(!metodoSelect || !tipoSelect || !fileContainer) return;

        const esEgreso = tipoSelect.value === 'Egreso';
        const esNoEfectivo = metodoSelect.value === '2' || metodoSelect.value === '3';

        if(esEgreso || esNoEfectivo) {
            fileContainer.style.display = 'block';
            if (hintEgreso) hintEgreso.classList.toggle('hidden', !esEgreso);
        } else {
            fileContainer.style.display = 'none';
            document.getElementById('voucherFile').value = '';
        }
    },

    async abrirModalCierre() {
        this.modo = 'CIERRE';
        this.prepararModal("ARQUEO Y CIERRE DE CAJA", 'sec-cierre', true);
        
        const res = await api.get(`/caja/detalle/${this.cajaActiva.CajaID}`);
        const inicial = parseFloat(this.cajaActiva.MontoApertura);
        
        let inEfe = 0, outEfe = 0;
        let inTransf = 0, inTarjeta = 0;
        
        res.data.forEach(m => {
            const monto = parseFloat(m.Monto);
            const metodo = parseInt(m.MetodoID) || 1;
            
            if (metodo === 1) {
                if (m.TipoMovimiento === 'Ingreso') inEfe += monto;
                else outEfe += monto;
            } 
            else if (metodo === 2 && m.TipoMovimiento === 'Ingreso') inTransf += monto;
            else if (metodo === 3 && m.TipoMovimiento === 'Ingreso') inTarjeta += monto;
        });

        // EL SALDO ESPERADO TOTAL AHORA ES GLOBAL (EFECTIVO + TRANSF + TARJ)
        this.saldoEsperadoActual = parseFloat(((inicial + inEfe + inTransf + inTarjeta) - outEfe).toFixed(2));

        try {
            document.getElementById('sys-inicial').textContent = `$${inicial.toFixed(2)}`;
            document.getElementById('sys-ingresos-efe').textContent = `+$${inEfe.toFixed(2)}`;
            document.getElementById('sys-egresos-efe').textContent = `-$${outEfe.toFixed(2)}`;
            document.getElementById('sys-esperado-efe').textContent = `$${this.saldoEsperadoActual.toFixed(2)}`;
            
            document.getElementById('sys-transferencias').textContent = `$${inTransf.toFixed(2)}`;
            document.getElementById('sys-tarjetas').textContent = `$${inTarjeta.toFixed(2)}`;
            
            const elTransf = document.getElementById('declara-transferencia');
            const elTarj = document.getElementById('declara-tarjeta');
            if (elTransf) elTransf.value = '';
            if (elTarj) elTarj.value = '';
        } catch(e) {}

        document.querySelectorAll('.denom-input').forEach(input => input.value = '');
        document.getElementById('obsCierre').value = '';
        this.activarConteoDinamico();
    },

    activarConteoDinamico() {
        // Clonamos para limpiar eventos anteriores
        document.querySelectorAll('.denom-input, .denom-adicional').forEach(input => {
            input.replaceWith(input.cloneNode(true));
        });

        const inputsEfectivo = document.querySelectorAll('.denom-input');
        const inputTransf = document.getElementById('declara-transferencia');
        const inputTarj = document.getElementById('declara-tarjeta');
        
        const recalcular = () => {
            let totalEfectivo = 0;
            let desglose = {};

            // 1. Sumar billetes
            inputsEfectivo.forEach(input => {
                const cantidad = parseInt(input.value) || 0;
                const valor = parseFloat(input.dataset.valor);
                if(cantidad > 0) {
                    totalEfectivo += (cantidad * valor);
                    desglose[valor] = cantidad; 
                }
            });

            // 2. Sumar digitales (AQUÍ ESTÁN LAS TRANSFERENCIAS DE VUELTA)
            const valTransf = (inputTransf && inputTransf.value) ? parseFloat(inputTransf.value) : 0;
            const valTarj = (inputTarj && inputTarj.value) ? parseFloat(inputTarj.value) : 0;
            
            desglose['Transferencias'] = valTransf;
            desglose['Tarjetas'] = valTarj;

            // 3. Diferencia Global (Efectivo físico + Digital declarado)
            const totalContado = parseFloat((totalEfectivo + valTransf + valTarj).toFixed(2));
            
            // PARCHE MATEMÁTICO: Obliga a JS a redondear el residuo microscópico a 2 decimales limpios
            const diferencia = parseFloat((totalContado - this.saldoEsperadoActual).toFixed(2));

            try {
                document.getElementById('ui-total-fisico').textContent = `$${totalContado.toFixed(2)}`;
                
                const elDif = document.getElementById('ui-diferencia');
                const cardDif = document.getElementById('card-diferencia');
                
                elDif.textContent = `$${diferencia.toFixed(2)}`;
                
                if (diferencia === 0) {
                    elDif.style.color = 'var(--hotel-success)'; 
                    cardDif.style.borderColor = 'var(--hotel-success)';
                } else if (diferencia < 0) {
                    elDif.style.color = 'var(--hotel-danger)'; 
                    cardDif.style.borderColor = 'var(--hotel-danger)';
                } else {
                    elDif.style.color = '#f39c12'; 
                    cardDif.style.borderColor = '#f39c12';
                }
            } catch(e) {}

            this.montoDeclaradoActual = totalContado;
            this.desgloseActual = desglose;
        };

        document.querySelectorAll('.denom-input, .denom-adicional').forEach(input => {
            input.addEventListener('input', recalcular);
        });
        
        recalcular(); 
    },

    prepararModal(titulo, seccionVisible, esAncho) {
        document.getElementById('modalCajaTitulo').textContent = titulo;
        
        const modalContent = document.getElementById('cajaModalContent');
        if (esAncho) {
            modalContent.classList.add('modal-wide');
        } else {
            modalContent.classList.remove('modal-wide');
        }

        ['sec-apertura', 'sec-movimiento', 'sec-cierre'].forEach(sec => {
            const seccionHTML = document.getElementById(sec);
            if(seccionHTML) {
                seccionHTML.classList.add('hidden');
                seccionHTML.querySelectorAll('input, select, textarea').forEach(field => field.disabled = true);
            }
        });
        
        const seccionActiva = document.getElementById(seccionVisible);
        if(seccionActiva) {
            seccionActiva.classList.remove('hidden');
            seccionActiva.querySelectorAll('input, select, textarea').forEach(field => field.disabled = false);
        }
        
        const form = document.getElementById('formCaja');
        if(form) form.reset();
        
        document.getElementById('modalCaja').classList.remove('hidden');
    },

    cerrarModal() {
        document.getElementById('modalCaja').classList.add('hidden');
    },

    async listarHistorial() {
        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const sedeId = localStorage.getItem('currentSedeId') || user.SedeID;
            
            const fInicioInput = document.getElementById('f-inicio');
            const fFinInput = document.getElementById('f-fin');
            const fInicio = fInicioInput ? fInicioInput.value : '';
            const fFin = fFinInput ? fFinInput.value : '';

            const res = await api.get(`/caja/reporte-admin?sedeId=${sedeId}&fechaInicio=${fInicio}&fechaFin=${fFin}`);
            const historial = res.data;
            const body = document.getElementById('tablaHistorialBody');
            
            if (!body) return;

            body.innerHTML = historial.map(c => `
                <tr>
                    <td><strong>#${c.CajaID}</strong></td>
                    <td>${c.Cajero}</td>
                    <td style="font-size:0.7rem; color:#718096;">${c.FechaAperturaFmt}</td>
                    <td style="font-size:0.7rem; color:#718096;">${c.FechaCierreFmt ? c.FechaCierreFmt : '<span class="status-pill active">ABIERTA</span>'}</td>
                    <td>$${c.MontoApertura.toFixed(2)}</td>
                    <td style="font-weight:800; color:var(--hotel-blue);">$${c.MontoCierre ? c.MontoCierre.toFixed(2) : '---'}</td>
                    <td style="color:${c.Diferencia < 0 ? 'var(--hotel-danger)' : (c.Diferencia > 0 ? '#f39c12' : 'var(--hotel-success)')}; font-weight:800;">
                        ${c.Diferencia != null ? '$'+c.Diferencia.toFixed(2) : '0.00'}
                    </td>
                    <td>
                        <div style="display:flex; gap:10px; justify-content:center;">
                            ${!c.FechaCierreFmt ? `
                                <button class="btn-neo" style="padding:6px 10px; color:var(--hotel-success);" onclick="CajaModule.abrirMonitorVivo(${c.CajaID})" title="Monitor en Vivo (ver y anular movimientos)">
                                    <i class="fas fa-satellite-dish"></i>
                                </button>
                            ` : ''}
                            <button class="btn-neo" style="padding:6px 10px;" onclick="CajaModule.imprimirArqueo(${c.CajaID})" title="Imprimir Ticket Financiero">
                                <i class="fas fa-print"></i>
                            </button>
                            <button class="btn-neo" style="padding:6px 10px; color:var(--hotel-gold);" onclick="CajaModule.imprimirEntregaTurno(${c.CajaID})" title="Reporte Entrega de Turno (Stock + Consumos)">
                                <i class="fas fa-boxes"></i>
                            </button>
                            ${!c.FechaCierreFmt ? '' : `
                                <button class="btn-neo" style="padding:6px 10px; color:var(--hotel-danger);" onclick="CajaModule.prepararReapertura(${c.CajaID})" title="Reabrir Turno">
                                    <i class="fas fa-unlock-alt"></i>
                                </button>
                            `}
                        </div>
                    </td>
                </tr>
            `).join('');
        } catch (err) { console.error("Error cargando historial:", err); }
    },

   async imprimirArqueo(cajaId) {
        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const sedeId = localStorage.getItem('currentSedeId') || user.SedeID;
            
            const resCaja = await api.get(`/caja/reporte-admin?sedeId=${sedeId}`); 
            const infoCaja = resCaja.data.find(c => c.CajaID === cajaId);

            if(!infoCaja) return window.Toast.fire({ icon: 'error', title: 'Registro no encontrado' });

            // 1. Lógica para procesar el desglose físico y transferencias
            let htmlDesglose = '';
            if (infoCaja.DesgloseFisico && infoCaja.DesgloseFisico !== '{}') {
                try {
                    const desglose = JSON.parse(infoCaja.DesgloseFisico);
                    htmlDesglose += `<div class="hr"></div><p class="bold text-center" style="margin: 5px 0;">DESGLOSE DECLARADO</p>`;
                    
                    for (const [llave, valor] of Object.entries(desglose)) {
                        if (llave === 'Transferencias' || llave === 'Tarjetas') {
                            if (parseFloat(valor) > 0) {
                                htmlDesglose += `<div class="flex"><span>${llave.toUpperCase()}:</span> <span>$${parseFloat(valor).toFixed(2)}</span></div>`;
                            }
                        } else {
                            const denominacion = parseFloat(llave);
                            const cantidad = parseInt(valor);
                            if (cantidad > 0) {
                                const totalLinea = (denominacion * cantidad).toFixed(2);
                                htmlDesglose += `<div class="flex"><span>${cantidad} x $${denominacion}</span> <span>$${totalLinea}</span></div>`;
                            }
                        }
                    }
                } catch(e) {
                    console.error("Error al parsear DesgloseFisico", e);
                }
            }

            // 2. Formatear las observaciones
            const notasAuditoria = infoCaja.ObservacionesCierre 
                ? `<div class="hr"></div>
                   <p class="bold" style="margin: 5px 0;">NOTAS DE AUDITORÍA:</p>
                   <p style="margin: 3px 0; font-size: 11px; word-wrap: break-word;">${infoCaja.ObservacionesCierre}</p>` 
                : '';

            const win = window.open('', '_blank', 'width=400,height=800');
            win.document.write(`
                <html>
                <head>
                    <title>Ticket Arqueo #${cajaId}</title>
                    <style>
                        body { font-family: 'Courier New', Courier, monospace; font-size: 12px; padding: 20px; width: 300px; color: #000; }
                        .text-center { text-align: center; }
                        .hr { border-bottom: 1px dashed #000; margin: 10px 0; }
                        .flex { display: flex; justify-content: space-between; margin-bottom: 3px; }
                        .bold { font-weight: bold; }
                    </style>
                </head>
                <body onload="setTimeout(()=> { window.print(); window.close(); }, 500)">
                    <div class="text-center">
                        <h2 style="margin:0;">MASTER HOTEL</h2>
                        <p style="margin: 5px 0;">${infoCaja.Sede}</p>
                        <p style="margin: 5px 0;">REPORTE DE ARQUEO DE CAJA</p>
                        <p class="bold" style="font-size: 14px;">TURNO: #${cajaId}</p>
                    </div>
                    <div class="hr"></div>
                    <p style="margin: 3px 0;">CAJERO: ${infoCaja.Cajero}</p>
                    <p style="margin: 3px 0;">APERTURA: ${infoCaja.FechaAperturaFmt}</p>
                    <p style="margin: 3px 0;">CIERRE: ${infoCaja.FechaCierreFmt ? infoCaja.FechaCierreFmt : 'TURNO ACTIVO'}</p>
                    <div class="hr"></div>
                    <div class="flex"><span>FONDO INICIAL:</span> <span>$${infoCaja.MontoApertura.toFixed(2)}</span></div>
                    <div class="flex"><span>INGRESOS (GLOBAL):</span> <span>$${infoCaja.TotalIngresos.toFixed(2)}</span></div>
                    <div class="flex"><span>EGRESOS (GLOBAL):</span> <span>-$${infoCaja.TotalEgresos.toFixed(2)}</span></div>
                    <div class="hr"></div>
                    <div class="flex bold"><span>TOTAL ESPERADO:</span> <span>$${(infoCaja.MontoApertura + infoCaja.TotalIngresos - infoCaja.TotalEgresos).toFixed(2)}</span></div>
                    <div class="flex bold"><span>TOTAL DECLARADO:</span> <span>$${infoCaja.MontoCierre?.toFixed(2) || '0.00'}</span></div>
                    <div class="flex bold">
                        <span>DIFERENCIA:</span> <span>$${infoCaja.Diferencia?.toFixed(2) || '0.00'}</span>
                    </div>
                    
                    ${htmlDesglose}
                    ${notasAuditoria}

                    <div class="hr"></div>
                    <p class="text-center" style="margin-top: 20px;">Firma Cajero</p>
                    <br><br><br>
                    <div class="hr"></div>
                    <p class="text-center" style="margin-top: 20px;">Firma Auditor/Admin</p>
                    <br><br><br>
                    <div class="hr"></div>
                    <p class="text-center">--- FIN DEL REPORTE ---</p>
                </body>
                </html>
            `);
            win.document.close();
        } catch (e) { 
            console.error(e);
            window.Toast.fire({ icon: 'error', title: 'Error al generar ticket' }); 
        }
    },

    // ==========================================
    // NUEVO: REPORTE DE ENTREGA DE TURNO
    // Incluye consumos POS del turno + stock actual
    // ==========================================
    async imprimirEntregaTurno(cajaId) {
        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const sedeId = localStorage.getItem('currentSedeId') || user.SedeID;

            // Cargamos info financiera del turno
            const resCaja = await api.get(`/caja/reporte-admin?sedeId=${sedeId}`);
            const infoCaja = resCaja.data.find(c => c.CajaID === cajaId);
            if (!infoCaja) return window.Toast.fire({ icon: 'error', title: 'Turno no encontrado' });

            // Cargamos consumos + stock del turno (endpoint nuevo)
            const resEntrega = await api.get(`/caja/entrega-turno/${cajaId}/${sedeId}`);
            const { consumos, stockActual } = resEntrega.data;

            // ── SECCIÓN DE CONSUMOS POS ──
            let htmlConsumos = '';
            if (consumos.length === 0) {
                htmlConsumos = `<p style="text-align:center; font-size:11px; opacity:0.6;">Sin consumos POS en este turno</p>`;
            } else {
                let totalConsumos = 0;
                const filas = consumos.map(c => {
                    totalConsumos += parseFloat(c.SubtotalTotal);
                    const cortesiaTag = c.HuboCortesia ? ' <small>(c/cortesía)</small>' : '';
                    return `<div class="flex"><span>${c.CantidadTotal}x ${c.Producto}${cortesiaTag}</span><span>$${parseFloat(c.SubtotalTotal).toFixed(2)}</span></div>`;
                }).join('');
                htmlConsumos = filas + `<div class="hr"></div><div class="flex bold"><span>TOTAL CONSUMOS:</span><span>$${totalConsumos.toFixed(2)}</span></div>`;
            }

            // ── SECCIÓN DE STOCK ──
            const criticos = stockActual.filter(p => p.EsCritico);
            const normales = stockActual.filter(p => !p.EsCritico);

            const filasCriticos = criticos.length > 0
                ? `<p class="bold" style="margin:5px 0; color:#000;">⚠ BAJO STOCK MÍNIMO:</p>` +
                  criticos.map(p => `<div class="flex"><span>${p.Nombre}</span><span style="font-weight:bold;">${p.StockActual} (mín: ${p.StockMinimo})</span></div>`).join('')
                : '';

            const filasNormales = normales.map(p =>
                `<div class="flex"><span>${p.Nombre}</span><span>${p.StockActual}</span></div>`
            ).join('');

            const now = new Date().toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' });

            const win = window.open('', '_blank', 'width=420,height=900');
            win.document.write(`
                <html>
                <head>
                    <title>Entrega de Turno #${cajaId}</title>
                    <style>
                        body { font-family: 'Courier New', Courier, monospace; font-size: 12px; padding: 20px; width: 320px; color: #000; }
                        .text-center { text-align: center; }
                        .hr { border-bottom: 1px dashed #000; margin: 8px 0; }
                        .flex { display: flex; justify-content: space-between; margin-bottom: 3px; font-size: 11px; }
                        .bold { font-weight: bold; }
                        .section-title { font-weight: bold; font-size: 13px; margin: 10px 0 5px 0; text-transform: uppercase; }
                    </style>
                </head>
                <body onload="setTimeout(()=> { window.print(); window.close(); }, 600)">

                    <div class="text-center">
                        <h2 style="margin:0;">MASTER HOTEL</h2>
                        <p style="margin:4px 0;">${infoCaja.Sede}</p>
                        <p class="bold" style="font-size:13px; margin:4px 0;">REPORTE DE ENTREGA DE TURNO</p>
                        <p style="margin:3px 0;">TURNO #${cajaId} | ${infoCaja.Cajero}</p>
                        <p style="margin:3px 0; font-size:11px;">Apertura: ${infoCaja.FechaAperturaFmt}</p>
                        <p style="margin:3px 0; font-size:11px;">Cierre: ${infoCaja.FechaCierreFmt || 'TURNO ACTIVO'}</p>
                        <p style="margin:3px 0; font-size:10px; opacity:0.6;">Impreso: ${now}</p>
                    </div>

                    <div class="hr"></div>

                    <!-- RESUMEN FINANCIERO DEL TURNO -->
                    <p class="section-title">💰 RESUMEN FINANCIERO</p>
                    <div class="flex"><span>Fondo inicial:</span><span>$${infoCaja.MontoApertura.toFixed(2)}</span></div>
                    <div class="flex"><span>Total ingresos:</span><span>$${infoCaja.TotalIngresos.toFixed(2)}</span></div>
                    <div class="flex"><span>Total egresos:</span><span>-$${infoCaja.TotalEgresos.toFixed(2)}</span></div>
                    <div class="flex bold"><span>TOTAL A ENTREGAR:</span><span>$${(infoCaja.MontoApertura + infoCaja.TotalIngresos - infoCaja.TotalEgresos).toFixed(2)}</span></div>

                    <div class="hr"></div>

                    <!-- CONSUMOS POS DEL TURNO -->
                    <p class="section-title">🛒 CONSUMOS POS DEL TURNO</p>
                    ${htmlConsumos}

                    <div class="hr"></div>

                    <!-- STOCK ACTUAL AL CIERRE -->
                    <p class="section-title">📦 INVENTARIO AL CIERRE DEL TURNO</p>
                    ${filasCriticos}
                    ${criticos.length > 0 && normales.length > 0 ? '<div class="hr"></div>' : ''}
                    ${filasNormales}

                    <div class="hr"></div>

                    <!-- FIRMAS -->
                    <p style="margin-top:15px; font-size:11px;">Cajero que entrega:</p>
                    <br><br>
                    <div class="hr"></div>
                    <p style="margin-top:15px; font-size:11px;">Cajero que recibe:</p>
                    <br><br>
                    <div class="hr"></div>
                    <p style="margin-top:15px; font-size:11px;">Supervisor / Admin:</p>
                    <br><br>
                    <div class="hr"></div>
                    <p class="text-center" style="margin-top:10px; font-size:10px;">--- FIN DE ENTREGA DE TURNO ---</p>
                </body>
                </html>
            `);
            win.document.close();

        } catch (e) {
            console.error(e);
            window.Toast.fire({ icon: 'error', title: 'Error al generar reporte de entrega' });
        }
    },

    async prepararReapertura(cajaId) {
        const { value: formValues } = await Swal.fire({
            title: 'AUTORIZACIÓN REQUERIDA',
            html: `
                <p style="font-size:0.8rem; color:#718096; margin-bottom:15px; font-weight:bold;">Solo un Administrador puede reabrir un turno.</p>
                <input id="swal-user" class="swal2-input" placeholder="Usuario Administrador" style="margin-bottom:10px;">
                <input id="swal-pass" type="password" class="swal2-input" placeholder="Contraseña Admin">
                <textarea id="swal-motivo" class="swal2-input" placeholder="Motivo de la reapertura obligatoria" rows="2" style="margin-top:10px;"></textarea>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'REABRIR TURNO',
            cancelButtonText: 'CANCELAR',
            confirmButtonColor: 'var(--hotel-danger)',
            background: 'var(--hotel-bg)',
            preConfirm: () => {
                const user = document.getElementById('swal-user').value;
                const pass = document.getElementById('swal-pass').value;
                const mot = document.getElementById('swal-motivo').value;
                if(!user || !pass || !mot) {
                    Swal.showValidationMessage('Debe llenar todos los campos');
                }
                return { user, pass, motivo: mot }
            }
        });

        if (formValues && formValues.user && formValues.pass) {
            try {
                const res = await api.post('/caja/reabrir', {
                    cajaId: cajaId,
                    usuarioAdmin: formValues.user,
                    passwordAdmin: formValues.pass,
                    motivo: formValues.motivo
                });

                if (res.data.success) {
                    await Swal.fire({
                        title: 'ÉXITO', 
                        text: res.data.message, 
                        icon: 'success',
                        background: 'var(--hotel-bg)',
                        confirmButtonColor: 'var(--hotel-blue)'
                    });
                    await this.checkEstado();
                    this.listarHistorial();
                }
            } catch (err) {
                Swal.fire({
                    title: 'ERROR', 
                    text: err.response?.data?.message || 'Fallo de autenticación', 
                    icon: 'error',
                    background: 'var(--hotel-bg)',
                    confirmButtonColor: 'var(--hotel-blue)'
                });
            }
        }
    },

    async solicitarAnulacion(movimientoId, recepcionId = 0) {
        const esCheckin = recepcionId && parseInt(recepcionId) > 0;
        const { value: formValues } = await Swal.fire({
            title: esCheckin ? 'ANULAR CHECK-IN COMPLETO' : 'ELIMINAR MOVIMIENTO',
            html: `
                <p style="font-size:0.8rem; color:${esCheckin ? 'var(--hotel-danger)' : '#718096'}; margin-bottom:15px; font-weight:bold;">
                    ${esCheckin
                        ? 'Esto revertirá TODO el check-in: libera la habitación (DISPONIBLE), devuelve los consumos al inventario, libera el parqueadero y borra los pagos del folio. Requiere clave de Administrador.'
                        : 'Solo un Administrador puede eliminar un ingreso/egreso mal registrado.'}
                </p>
                <input id="swal-anul-user" class="swal2-input" placeholder="Usuario Administrador" style="margin-bottom:10px;">
                <input id="swal-anul-pass" type="password" class="swal2-input" placeholder="Contraseña Admin">
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: esCheckin ? 'ANULAR TODO EL CHECK-IN' : 'ELIMINAR REGISTRO',
            cancelButtonText: 'CANCELAR',
            confirmButtonColor: 'var(--hotel-danger)',
            background: 'var(--hotel-bg)',
            preConfirm: () => {
                const user = document.getElementById('swal-anul-user').value;
                const pass = document.getElementById('swal-anul-pass').value;
                if (!user || !pass) {
                    Swal.showValidationMessage('Debe ingresar usuario y contraseña de administrador');
                }
                return { user, pass };
            }
        });

        if (formValues && formValues.user && formValues.pass) {
            try {
                const endpoint = esCheckin ? '/caja/recepcion/anular-completa' : '/caja/movimiento/anular';
                const payload = esCheckin
                    ? { recepcionId: parseInt(recepcionId), usuarioAdmin: formValues.user, passwordAdmin: formValues.pass }
                    : { movimientoId: movimientoId, usuarioAdmin: formValues.user, passwordAdmin: formValues.pass };

                const res = await api.post(endpoint, payload);

                if (res.data.success) {
                    await Swal.fire({
                        title: esCheckin ? 'CHECK-IN ANULADO' : 'ELIMINADO',
                        text: res.data.message,
                        icon: 'success',
                        background: 'var(--hotel-bg)',
                        confirmButtonColor: 'var(--hotel-blue)'
                    });
                    await this.cargarDatosDashboard();
                }
            } catch (err) {
                Swal.fire({
                    title: 'ERROR',
                    text: err.response?.data?.message || 'No se pudo eliminar el movimiento.',
                    icon: 'error',
                    background: 'var(--hotel-bg)',
                    confirmButtonColor: 'var(--hotel-blue)'
                });
            }
        }
    },

    async abrirMonitorVivo(cajaId) {
        // Renderiza la tabla de movimientos dentro del monitor.
        // Se guarda en una variable LOCAL (closure) para que el intervalo siempre
        // tenga una función válida, aunque this._monitorRender cambie/se limpie.
        const render = async () => {
            try {
                const res = await api.get(`/caja/detalle/${cajaId}`);
                const movs = res.data;
                const cont = document.getElementById('monitor-body');
                if (!cont) return; // monitor cerrado
                if (!movs || movs.length === 0) {
                    cont.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#718096; padding:14px;">Sin movimientos en este turno</td></tr>';
                    return;
                }
                cont.innerHTML = movs.map(m => {
                    const cerrado = (m.CierreMaestroID !== null && m.CierreMaestroID !== undefined);
                    const mCk = (m.Observacion || '').match(/CHECK-IN \| Folio #(\d+)/);
                    const recId = mCk ? mCk[1] : 0;
                    const btn = cerrado
                        ? '<i class="fas fa-lock" style="color:#718096;" title="Periodo cerrado"></i>'
                        : `<button type="button" class="btn-neo" style="padding:5px 9px; color:var(--hotel-danger);" title="${recId ? 'Anular check-in completo' : 'Anular'}" onclick="CajaModule.anularDesdeMonitor(${cajaId}, ${m.MovimientoID}, ${recId})"><i class="fas fa-trash-alt"></i></button>`;
                    const color = m.TipoMovimiento === 'Ingreso' ? 'var(--hotel-success)' : 'var(--hotel-danger)';
                    return `<tr>
                        <td style="font-size:0.72rem; color:#718096;">${m.FechaMovFmt || ''}</td>
                        <td style="font-weight:700;">${m.TipoMovimiento}${recId ? ' <span style=\"font-size:0.6rem; color:var(--hotel-danger);\">(CHECK-IN)</span>' : ''}</td>
                        <td>${m.Metodo || 'EFECTIVO'}</td>
                        <td style="text-align:right; font-weight:800; color:${color};">${m.TipoMovimiento === 'Ingreso' ? '+' : '-'}$${parseFloat(m.Monto).toFixed(2)}</td>
                        <td style="text-align:center;">${btn}</td>
                    </tr>`;
                }).join('');
            } catch (e) { /* refresco silencioso */ }
        };
        // Exponer el render para refresco inmediato tras anular
        this._monitorRender = render;

        await Swal.fire({
            title: `MONITOR EN VIVO · CAJA #${cajaId}`,
            width: 720,
            html: `
                <p style="font-size:0.75rem; color:#718096; margin-bottom:10px;">Vista en tiempo real (se actualiza sola). Puede anular movimientos directamente; se le pedirá su clave de administrador.</p>
                <div style="max-height:340px; overflow:auto; border:1px solid #e2e8f0; border-radius:8px;">
                  <table style="width:100%; font-size:0.8rem; border-collapse:collapse;">
                    <thead><tr style="background:#f7fafc;">
                      <th style="padding:6px;">Hora</th><th>Tipo</th><th>Método</th>
                      <th style="text-align:right; padding:6px;">Monto</th><th style="text-align:center;">Anular</th>
                    </tr></thead>
                    <tbody id="monitor-body"><tr><td colspan="5" style="text-align:center; padding:14px;">Cargando...</td></tr></tbody>
                  </table>
                </div>
                <input id="monitor-admin-pass" type="password" class="swal2-input" placeholder="Clave de administrador (para anular)" style="margin-top:12px;">
            `,
            background: 'var(--hotel-bg)',
            showConfirmButton: true,
            confirmButtonText: 'CERRAR MONITOR',
            confirmButtonColor: 'var(--hotel-blue)',
            didOpen: () => {
                render();
                this._monitorInterval = setInterval(render, 8000);
            },
            willClose: () => {
                if (this._monitorInterval) clearInterval(this._monitorInterval);
                this._monitorInterval = null;
                this._monitorRender = null;
            }
        });
    },

    async anularDesdeMonitor(cajaId, movimientoId, recepcionId = 0) {
        const user = JSON.parse(localStorage.getItem('user'));
        const passField = document.getElementById('monitor-admin-pass');
        const pass = passField ? passField.value : '';
        if (!pass) {
            return window.Toast.fire({ icon: 'warning', title: 'Escriba su clave de administrador abajo' });
        }

        const esCheckin = recepcionId && parseInt(recepcionId) > 0;
        if (esCheckin) {
            const conf = await Swal.fire({
                title: 'ANULAR CHECK-IN COMPLETO',
                text: 'Se liberará la habitación, se devolverán los consumos al inventario, se liberará el parqueadero y se borrarán los pagos del folio. ¿Continuar?',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'SÍ, ANULAR TODO',
                cancelButtonText: 'CANCELAR',
                confirmButtonColor: 'var(--hotel-danger)',
                background: 'var(--hotel-bg)'
            });
            if (!conf.isConfirmed) return;
        }

        try {
            const endpoint = esCheckin ? '/caja/recepcion/anular-completa' : '/caja/movimiento/anular';
            const payload = esCheckin
                ? { recepcionId: parseInt(recepcionId), adminUsuarioId: user.UsuarioID, passwordAdmin: pass }
                : { movimientoId: movimientoId, adminUsuarioId: user.UsuarioID, passwordAdmin: pass };

            const res = await api.post(endpoint, payload);
            if (res.data.success) {
                window.Toast.fire({ icon: 'success', title: esCheckin ? 'Check-in anulado' : 'Movimiento anulado' });
                if (this._monitorRender) this._monitorRender(); // refresco inmediato del monitor
            }
        } catch (err) {
            window.Toast.fire({ icon: 'error', title: err.response?.data?.message || 'No se pudo anular' });
        }
    },

    // ═══ PASARELA ════════════════════════════════════════════════════════════

    async _verificarPasarela() {
        try {
            const r = await api.get('/pagos/estado');
            this._pasarelaHabilitada = r.data.habilitada;
            const btn = document.getElementById('btn-cobro-pasarela');
            if (btn && this._pasarelaHabilitada) btn.classList.remove('hidden');

            // Escuchar evento pago:resultado via socket
            if (window.socket && this._pasarelaHabilitada) {
                window.socket.on('pago:resultado', (data) => this._onPagoResultado(data));
            }
        } catch (_) {}
    },

    abrirCobroPasarela() {
        if (!this._pasarelaHabilitada) return;
        document.getElementById('paso-datos-pasarela').style.display = '';
        document.getElementById('paso-espera-pasarela').style.display = 'none';
        document.getElementById('paso-resultado-pasarela').style.display = 'none';
        document.getElementById('pas-monto').value = '';
        document.getElementById('pas-concepto').value = '';
        document.getElementById('pas-email').value = '';
        this._pasClt = null;
        this._pasUrl = null;
        const overlay = document.getElementById('overlay-pasarela');
        overlay.style.display = 'flex';
    },

    cerrarCobroPasarela() {
        document.getElementById('overlay-pasarela').style.display = 'none';
        this._pasClt = null;
        this._pasUrl = null;
    },

    async generarEnlacePago() {
        const monto    = parseFloat(document.getElementById('pas-monto').value);
        const concepto = document.getElementById('pas-concepto').value.trim();
        const email    = document.getElementById('pas-email').value.trim();

        if (!monto || monto <= 0) { Swal.fire('Error', 'Ingrese un monto válido.', 'warning'); return; }

        try {
            const r = await api.post('/pagos/iniciar', { monto, concepto, email });
            this._pasClt = r.data.clientTransactionId;
            this._pasUrl = r.data.payUrl;

            document.getElementById('pas-url-display').textContent = this._pasUrl;
            document.getElementById('pas-qr').src =
                `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(this._pasUrl)}`;

            document.getElementById('paso-datos-pasarela').style.display = 'none';
            document.getElementById('paso-espera-pasarela').style.display = '';
        } catch (err) {
            Swal.fire('Error', err.response?.data?.error || err.message, 'error');
        }
    },

    copiarEnlace() {
        if (!this._pasUrl) return;
        navigator.clipboard.writeText(this._pasUrl).then(() => {
            Swal.fire({ toast:true, position:'top-end', icon:'success', title:'Enlace copiado', timer:1800, showConfirmButton:false });
        });
    },

    abrirEnlaceExterno() {
        if (!this._pasUrl) return;
        // Electron: abre en el navegador del sistema
        try { require('electron').shell.openExternal(this._pasUrl); }
        catch (_) { window.open(this._pasUrl, '_blank'); }
    },

    async verificarPagoManual() {
        if (!this._pasClt) return;
        try {
            const r = await api.get(`/pagos/verificar/${this._pasClt}`);
            if (r.data.Estado === 'APROBADO') {
                this._onPagoResultado({ clientTransactionId: this._pasClt, aprobado: true, authCode: r.data.CodigoAutorizacion, monto: r.data.Monto });
            } else if (r.data.Estado === 'RECHAZADO' || r.data.Estado === 'CANCELADO') {
                this._onPagoResultado({ clientTransactionId: this._pasClt, aprobado: false });
            } else {
                Swal.fire({ toast:true, position:'top-end', icon:'info', title:'Pago aún pendiente', timer:2000, showConfirmButton:false });
            }
        } catch (_) {}
    },

    _onPagoResultado(data) {
        if (data.clientTransactionId !== this._pasClt) return;

        document.getElementById('paso-espera-pasarela').style.display = 'none';
        document.getElementById('paso-resultado-pasarela').style.display = '';

        if (data.aprobado) {
            document.getElementById('pas-resultado-ico').textContent = '✅';
            document.getElementById('pas-resultado-titulo').style.color = '#27ae60';
            document.getElementById('pas-resultado-titulo').textContent = '¡Pago aprobado!';
            document.getElementById('pas-resultado-detalle').textContent =
                `Monto: $${parseFloat(data.monto).toFixed(2)} · Auth: ${data.authCode || '—'}`;

            // Registrar automáticamente como movimiento de caja (MetodoID 3 = Tarjeta)
            if (this.cajaActiva) {
                api.post('/caja/movimiento', {
                    cajaId:  this.cajaActiva.CajaID,
                    tipo:    'Ingreso',
                    metodo:  3,
                    monto:   data.monto,
                    ref:     data.authCode || 'PASARELA',
                    obs:     document.getElementById('pas-concepto')?.value || 'Cobro con tarjeta (Pasarela)',
                }).then(() => this.checkEstado()).catch(() => {});
            }
        } else {
            document.getElementById('pas-resultado-ico').textContent = '❌';
            document.getElementById('pas-resultado-titulo').style.color = '#e74c3c';
            document.getElementById('pas-resultado-titulo').textContent = data.cancelado ? 'Pago cancelado' : 'Pago rechazado';
            document.getElementById('pas-resultado-detalle').textContent = 'El cliente no completó el pago.';
        }
    },

    // ═════════════════════════════════════════════════════════════════════════

    setupEventListeners() {
        const form = document.getElementById('formCaja');
        if (!form) return;

        const metodoSelect = document.getElementById('metodoMov');
        if(metodoSelect) {
            metodoSelect.addEventListener('change', () => this.gestionarCamposVoucher());
        }
        const tipoSelect = document.getElementById('tipoMov');
        if(tipoSelect) {
            tipoSelect.addEventListener('change', () => this.gestionarCamposVoucher());
        }

        form.onsubmit = async (e) => {
            e.preventDefault();
            const user = JSON.parse(localStorage.getItem('user'));
            const sedeId = localStorage.getItem('currentSedeId') || user.SedeID;

            try {
                if (this.modo === 'APERTURA') {
                    const monto = document.getElementById('montoApertura').value;
                    await api.post('/caja/abrir', { usuarioId: user.UsuarioID, sedeId, montoApertura: monto });
                    window.Toast.fire({ icon: 'success', title: 'TURNO INICIADO CORRECTAMENTE' });
                } 
                else if (this.modo === 'MOVIMIENTO') {
                    const tipoMovVal = document.getElementById('tipoMov').value;
                    const refVal = document.getElementById('refMov').value.trim();
                    const fileInput = document.getElementById('voucherFile');
                    const tieneVoucher = fileInput && fileInput.files[0];

                    if (tipoMovVal === 'Egreso' && !tieneVoucher && !refVal) {
                        return Swal.fire('Falta el sustento', 'Todo egreso debe respaldarse: adjunte la foto del comprobante o indique la referencia (Nro. de documento).', 'warning');
                    }

                    const formData = new FormData();
                    formData.append('cajaId', this.cajaActiva.CajaID);
                    formData.append('tipo', tipoMovVal);
                    formData.append('metodoId', document.getElementById('metodoMov').value);
                    formData.append('monto', document.getElementById('montoMov').value);
                    formData.append('ref', refVal);
                    formData.append('obs', document.getElementById('obsMov').value);

                    if (tieneVoucher) {
                        formData.append('voucher', fileInput.files[0]);
                    }

                    await api.post('/caja/movimiento', formData, {
                        headers: { 'Content-Type': 'multipart/form-data' }
                    });

                    window.Toast.fire({ icon: 'success', title: 'MOVIMIENTO REGISTRADO' });
                }
                else if (this.modo === 'CIERRE') {
                    const dif = parseFloat((this.montoDeclaradoActual - this.saldoEsperadoActual).toFixed(2));
                    const obs = document.getElementById('obsCierre').value.trim();
                    
                    if (dif !== 0 && obs === '') {
                        return Swal.fire({
                            icon: 'warning',
                            title: 'JUSTIFICACIÓN REQUERIDA',
                            text: 'El arqueo físico presenta una diferencia. Debe escribir una observación.',
                            confirmButtonColor: 'var(--hotel-blue)',
                            background: 'var(--hotel-bg)'
                        });
                    }

                    const confirm = await Swal.fire({
                        title: `¿PROCESAR CIERRE DE CAJA?`,
                        html: `Total Declarado: <strong>$${this.montoDeclaradoActual.toFixed(2)}</strong><br>
                               Diferencia Auditoría: <strong style="color:${dif === 0 ? 'green' : 'red'}">$${dif.toFixed(2)}</strong>`,
                        icon: 'warning',
                        showCancelButton: true,
                        confirmButtonColor: 'var(--hotel-blue)',
                        cancelButtonColor: 'var(--hotel-danger)',
                        confirmButtonText: 'SÍ, CERRAR TURNO',
                        cancelButtonText: 'CANCELAR',
                        background: 'var(--hotel-bg)'
                    });

                    if (!confirm.isConfirmed) return;

                    const res = await api.post('/caja/cerrar', {
                        cajaId: this.cajaActiva.CajaID,
                        montoDeclarado: parseFloat(this.montoDeclaradoActual.toFixed(2)),
                        obs: obs,
                        desgloseFisico: JSON.stringify(this.desgloseActual)
                    });
                    
                    const resDif = parseFloat(res.data.diferencia);
                    await Swal.fire({ 
                        title: resDif === 0 ? "¡CAJA CUADRADA PERFECTA!" : "TURNO CERRADO CON DESFASE", 
                        text: `El turno ha finalizado y se ha enviado a auditoría.`,
                        icon: resDif === 0 ? 'success' : 'warning', 
                        confirmButtonColor: 'var(--hotel-blue)',
                        confirmButtonText: 'ENTENDIDO',
                        background: 'var(--hotel-bg)' 
                    });
                }

                this.cerrarModal();
                await this.checkEstado();
                
            } catch (err) {
                const msg = err.response?.data?.message || "ERROR EN LA OPERACIÓN";
                window.Toast.fire({ icon: 'error', title: 'ERROR', text: msg.toUpperCase() });
            }
        };
    }
};

module.exports = CajaModule;