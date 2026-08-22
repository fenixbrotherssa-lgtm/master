const api = require('./api');
const { generarYAbrirComprobante, adjuntarComprobante: subirComprobante } = require('./comprobanteEgresoPrint');

const ReportesModule = {
    rubrosCache: [],
    metodosPagoCache: [],
    dashData: null,

    // ==========================================
    // HELPER: FORMATEAR FECHA SIN CONVERSIÓN UTC
    // Quita la Z para que JS no reste 5 horas (UTC-5 Ecuador)
    // ==========================================
    formatFecha(fechaStr, soloFecha = false) {
        if (!fechaStr) return '';
        // Quitamos la Z o el offset para evitar conversión UTC→local
        const limpio = String(fechaStr).replace('Z', '').replace(/\+.*$/, '').replace('T', ' ');
        const partes = limpio.split(/[- :\.]/);
        const fecha = new Date(partes[0], partes[1]-1, partes[2], partes[3]||0, partes[4]||0, partes[5]||0);
        if (soloFecha) return fecha.toLocaleDateString('es-EC');
        return fecha.toLocaleDateString('es-EC') + ' ' + fecha.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    },

    async init() {
        console.log("📊 Módulo de Finanzas Corporativas v3.0 Iniciado...");
        this.configurarFechasPorDefecto();
        this.renderSedeSelector();
        await this.cargarConfiguracionesMaestras();
        await this.cargarDashboard();
        this.setupEventListeners();
        window.ReportesModule = this;
    },

    renderSedeSelector() { App.renderSedeSelector('sedeSelectorReportes', () => { this.cargarDashboard(); }); },
    getSedeId() { const selector = document.getElementById('globalSedeSelector'); return selector ? selector.value : (App.user ? App.user.SedeID : 1); },

    configurarFechasPorDefecto() {
        const date = new Date();
        const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        document.getElementById('fechaInicioFinanzas').value = `${y}-${m}-01`;
        document.getElementById('fechaFinFinanzas').value = `${y}-${m}-${d}`;
    },

    async cargarConfiguracionesMaestras() {
        try {
            const [resRubros, resMetodos] = await Promise.all([api.get('/reportes/rubros'), api.get('/reportes/metodos-pago')]);
            this.rubrosCache = resRubros.data || [];
            this.metodosPagoCache = resMetodos.data || [];
            const selectMetodo = document.getElementById('movMetodo');
            if(selectMetodo) selectMetodo.innerHTML = this.metodosPagoCache.map(m => `<option value="${m.MetodoID}">${m.Nombre.toUpperCase()}</option>`).join('');
            this.filtrarRubrosForm();
        } catch (e) { console.error("Error dependencias: ", e); }
    },

    filtrarRubrosForm() {
        const tipoSeleccionado = document.getElementById('movTipo').value;
        const selectRubro = document.getElementById('movRubro');
        if(!selectRubro) return;
        const rubrosFiltrados = this.rubrosCache.filter(r => r.Tipo === tipoSeleccionado);
        selectRubro.innerHTML = rubrosFiltrados.map(r => `<option value="${r.RubroID}">${r.Nombre}</option>`).join('');
    },

    switchTab(tab) {
        document.getElementById('tabDashboard').classList.toggle('hidden', tab !== 'dashboard');
        document.getElementById('tabCierres').classList.toggle('hidden', tab !== 'cierres');
        document.getElementById('tabRubros').classList.toggle('hidden', tab !== 'rubros');
        document.getElementById('tabDeudores').classList.toggle('hidden', tab !== 'deudores');
        document.getElementById('tabSRI').classList.toggle('hidden', tab !== 'sri');
        document.getElementById('tabATS').classList.toggle('hidden', tab !== 'ats');
        document.getElementById('tabConsolidado').classList.toggle('hidden', tab !== 'consolidado');

        document.getElementById('btnNavDashboard').classList.toggle('active', tab === 'dashboard');
        document.getElementById('btnNavCierres').classList.toggle('active', tab === 'cierres');
        document.getElementById('btnNavRubros').classList.toggle('active', tab === 'rubros');
        document.getElementById('btnNavDeudores').classList.toggle('active', tab === 'deudores');
        document.getElementById('btnNavSRI').classList.toggle('active', tab === 'sri');
        document.getElementById('btnNavATS').classList.toggle('active', tab === 'ats');
        document.getElementById('btnNavConsolidado').classList.toggle('active', tab === 'consolidado');

        if (tab === 'cierres') this.cargarHistorialCierres();
        if (tab === 'rubros') this.renderRubrosLista();
        if (tab === 'deudores') this.cargarDeudores();
        if (tab === 'sri') this.cargarConsolidadoSRI();
        if (tab === 'ats') this.initAts();
        if (tab === 'consolidado') this.initConsolidado();
    },

    // ══════════════════ REPORTE CONSOLIDADO FISCAL ══════════════════

    initConsolidado() {
        const inDesde = document.getElementById('conDesde');
        const inHasta = document.getElementById('conHasta');
        if (inHasta && !inHasta.value) inHasta.value = new Date().toISOString().substring(0, 10);
        if (inDesde && !inDesde.value) inDesde.value = `${new Date().getFullYear()}-01-01`;
    },

    async consolidadoCargar() {
        const sedeId = this.getSedeId();
        const desde = document.getElementById('conDesde').value;
        const hasta = document.getElementById('conHasta').value;
        if (!desde || !hasta) return Swal.fire('Faltan fechas', 'Seleccione el período (desde/hasta).', 'warning');

        try {
            Swal.fire({ title: 'Conciliando período...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const [resResumen, resDetalle] = await Promise.all([
                api.get('/reporteconsolidado/resumen', { params: { sedeId, desde, hasta } }),
                api.get('/reporteconsolidado/detalle', { params: { sedeId, desde, hasta } })
            ]);
            Swal.close();

            const k = resResumen.data.kpis;
            document.getElementById('conVentasNetas').textContent = `$ ${k.ventasNetas.toFixed(2)}`;
            document.getElementById('conIvaVentas').textContent = `$ ${k.ivaVentas.toFixed(2)}`;
            document.getElementById('conIvaCompras').textContent = `$ ${k.ivaComprasDeclarable.toFixed(2)}`;
            document.getElementById('conTotalCompras').textContent = `$ ${k.totalCompras.toFixed(2)}`;
            document.getElementById('conTotalRetenido').textContent = `$ ${k.totalRetenido.toFixed(2)}`;
            document.getElementById('conBalanceIva').textContent = `$ ${k.balanceIva.toFixed(2)}`;
            const balanceCard = document.getElementById('conBalanceCard');
            balanceCard.className = 'kpi-card ' + (k.balanceIva >= 0 ? 'kpi-green' : 'kpi-red');

            document.getElementById('conCntFacturas').textContent = k.totalFacturas;
            document.getElementById('conCntNC').textContent = k.cantidadNC;
            document.getElementById('conCntND').textContent = k.cantidadND;
            document.getElementById('conCntCompras').textContent = k.cantidadCompras;
            document.getElementById('conCntComprasDecl').textContent = k.totalComprasDeclarable;
            document.getElementById('conCntRetenciones').textContent = k.cantidadRetenciones;

            const { ventas, compras, retenciones } = resDetalle.data;

            document.getElementById('conTablaVentas').innerHTML = ventas.length ? ventas.map(v => `
                <tr>
                    <td>${v.Tipo}</td><td>${v.Secuencial}</td><td>${String(v.FechaEmision).substring(0,10)}</td>
                    <td>${v.Cliente || '--'}</td>
                    <td>$${parseFloat(v.Subtotal).toFixed(2)}</td><td>$${parseFloat(v.IVA).toFixed(2)}</td><td>$${parseFloat(v.Total).toFixed(2)}</td>
                </tr>
            `).join('') : '<tr><td colspan="7" style="text-align:center; opacity:0.5;">Sin ventas en este período.</td></tr>';

            document.getElementById('conTablaCompras').innerHTML = compras.length ? compras.map(c => `
                <tr>
                    <td>${c.Secuencial}</td><td>${String(c.FechaEmision).substring(0,10)}</td><td>${c.Proveedor}</td>
                    <td>$${parseFloat(c.Subtotal).toFixed(2)}</td><td>$${parseFloat(c.IVA).toFixed(2)}</td><td>$${parseFloat(c.Total).toFixed(2)}</td>
                    <td>${c.Declarable ? '<span class="badge bg-green">SÍ</span>' : '<span class="badge bg-purple">NO</span>'}</td>
                </tr>
            `).join('') : '<tr><td colspan="7" style="text-align:center; opacity:0.5;">Sin compras en este período.</td></tr>';

            document.getElementById('conTablaRetenciones').innerHTML = retenciones.length ? retenciones.map(r => `
                <tr>
                    <td>${r.Secuencial}</td><td>${String(r.FechaEmision).substring(0,10)}</td><td>${r.Proveedor}</td>
                    <td>$${parseFloat(r.TotalRetenido).toFixed(2)}</td>
                </tr>
            `).join('') : '<tr><td colspan="4" style="text-align:center; opacity:0.5;">Sin retenciones en este período.</td></tr>';

            document.getElementById('consolidadoResultado').classList.remove('hidden');
        } catch (err) {
            Swal.close();
            Swal.fire('Error', err.response?.data?.error || 'No se pudo calcular el consolidado.', 'error');
        }
    },

    async consolidadoIntegridad() {
        try {
            Swal.fire({ title: 'Verificando archivos XML en disco...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const res = await api.get('/reporteconsolidado/integridad', { params: { sedeId: this.getSedeId() } });
            Swal.close();
            const { totalRevisados, totalProblemas, problemas } = res.data;

            if (!totalProblemas) {
                return Swal.fire('Todo en orden', `Se revisaron ${totalRevisados} comprobantes y todos tienen su XML respaldado en disco.`, 'success');
            }
            const filas = problemas.map(p => `<tr><td>${p.tabla}</td><td>${p.secuencial}</td><td>${p.tipo}</td></tr>`).join('');
            Swal.fire({
                icon: 'warning', title: `${totalProblemas} problema(s) encontrados`, width: 700,
                html: `<p style="font-size:0.8rem; color:#718096;">De ${totalRevisados} comprobantes revisados:</p>
                    <div style="max-height:320px; overflow-y:auto;"><table class="tabla-neo" style="font-size:0.75rem;"><thead><tr><th>Tabla</th><th>Secuencial</th><th>Problema</th></tr></thead><tbody>${filas}</tbody></table></div>`
            });
        } catch (err) {
            Swal.close();
            Swal.fire('Error', err.response?.data?.error || 'No se pudo verificar la integridad.', 'error');
        }
    },

    async consolidadoPDF() {
        const sedeId = this.getSedeId();
        const desde = document.getElementById('conDesde').value;
        const hasta = document.getElementById('conHasta').value;
        if (!desde || !hasta) return Swal.fire('Faltan fechas', 'Seleccione el período (desde/hasta).', 'warning');

        try {
            Swal.fire({ title: 'Generando PDF...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const res = await api.get('/reporteconsolidado/pdf', { params: { sedeId, desde, hasta } });
            Swal.close();
            if (res.data.success) {
                const base = api.defaults.baseURL.replace(/\/api\/?$/, '');
                window.open(`${base}${res.data.pdfUrl}`, '_blank');
            }
        } catch (err) {
            Swal.close();
            Swal.fire('Error', err.response?.data?.error || 'No se pudo generar el PDF.', 'error');
        }
    },

    // ══════════════════ ATS ══════════════════

    initAts() {
        const now = new Date();
        const inAnio = document.getElementById('atsAnio');
        const inMes  = document.getElementById('atsMes');
        if (inAnio && !inAnio.value) inAnio.value = now.getFullYear();
        if (inMes  && !inMes.dataset.set) { inMes.value = now.getMonth() + 1; inMes.dataset.set = '1'; }
    },

    async atsPreview() {
        const anio = document.getElementById('atsAnio').value;
        const mes  = document.getElementById('atsMes').value;
        if (!anio || !mes) return Swal.fire('Faltan datos', 'Seleccione año y mes.', 'warning');

        document.getElementById('atsResultCard').classList.add('hidden');
        this.ultimoATS = null;

        try {
            Swal.fire({ title: 'Recopilando información...', text: 'Ventas y compras del período.', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const res = await api.get(`/ats/${anio}/${mes}/preview`, { params: { sedeId: this.getSedeId() } });
            Swal.close();

            const { resumen, ventas, compras } = res.data;
            this.ultimoATSPreview = { anio, mes };

            document.getElementById('atsResFacturas').textContent = resumen.totalFacturas;
            document.getElementById('atsResNC').textContent = resumen.totalNotasCredito;
            document.getElementById('atsResND').textContent = resumen.totalNotasDebito;
            document.getElementById('atsResCompras').textContent = resumen.totalCompras;

            const tbodyVentas = document.getElementById('atsTablaVentas');
            tbodyVentas.innerHTML = ventas.length === 0
                ? '<tr><td colspan="5" style="text-align:center; opacity:0.5;">Sin ventas en este período.</td></tr>'
                : ventas.map(v => `
                    <tr>
                        <td>${v.nombre}<br><small style="opacity:0.6;">${v.documento}</small></td>
                        <td>${v.tipoComprobanteLabel}</td>
                        <td>${v.numeroComprobantes}</td>
                        <td>$${v.baseImpGrav.toFixed(2)}</td>
                        <td>$${v.montoIva.toFixed(2)}</td>
                    </tr>`).join('');

            const tbodyCompras = document.getElementById('atsTablaCompras');
            tbodyCompras.innerHTML = compras.length === 0
                ? '<tr><td colspan="7" style="text-align:center; opacity:0.5;">Sin compras en este período.</td></tr>'
                : compras.map(c => `
                    <tr>
                        <td>${c.Proveedor}<br><small style="opacity:0.6;">${c.Documento}</small></td>
                        <td>${c.Comprobante}</td>
                        <td>$${c.BaseImponible.toFixed(2)}</td>
                        <td>$${c.IVA.toFixed(2)}</td>
                        <td>$${c.ValorRetencionIva.toFixed(2)}</td>
                        <td>$${c.ValorRetencionRenta.toFixed(2)}</td>
                        <td><b>$${c.Total.toFixed(2)}</b></td>
                    </tr>`).join('');

            document.getElementById('atsPreviewCard').classList.remove('hidden');
        } catch (err) {
            Swal.close();
            Swal.fire('Error', err.response?.data?.error || 'No se pudo calcular la vista previa.', 'error');
        }
    },

    async atsGenerarConfirmar() {
        if (!this.ultimoATSPreview) return;
        const { anio, mes } = this.ultimoATSPreview;

        try {
            Swal.fire({ title: 'Generando archivo del ATS...', text: 'Empaquetando XML en el ZIP.', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const res = await api.post(`/ats/${anio}/${mes}/generar`, { sedeId: this.getSedeId() });
            Swal.close();

            this.ultimoATS = res.data;
            document.getElementById('atsResultFilename').textContent = res.data.filename;
            document.getElementById('atsResultCard').classList.remove('hidden');
            document.getElementById('atsResultCard').scrollIntoView({ behavior: 'smooth' });
            window.Toast.fire({ icon: 'success', title: 'Archivo del ATS generado' });
        } catch (err) {
            Swal.close();
            Swal.fire('Error', err.response?.data?.error || 'No se pudo generar el ATS.', 'error');
        }
    },

    atsVerXml() {
        if (!this.ultimoATS) return;
        Swal.fire({
            icon: 'info', title: 'XML del ATS', width: 700,
            html: `<textarea readonly style="width:100%; height:340px; font-family:Consolas,monospace; font-size:10.5px; background:#f1f3f5; border-radius:8px; padding:10px; border:1px solid #ccc;">${this.ultimoATS.xml.replace(/</g, '&lt;')}</textarea>`
        });
    },

    atsDescargar() {
        if (!this.ultimoATS) return;
        const base = api.defaults.baseURL.replace(/\/api\/?$/, '');
        window.open(`${base}${this.ultimoATS.zipUrl}`, '_blank');
    },

    async cargarDashboard() {
        const sedeId = this.getSedeId();
        const fInicio = document.getElementById('fechaInicioFinanzas').value;
        const fFin = document.getElementById('fechaFinFinanzas').value;

        try {
            const res = await api.post('/reportes/dashboard', { sedeId, fechaInicio: fInicio, fechaFin: fFin });
            const d = res.data;
            this.dashData = d; 

            document.getElementById('kpi-prod').textContent = `$ ${d.kpis.produccionTotal.toFixed(2)}`;
            document.getElementById('kpi-rec').textContent = `$ ${d.kpis.recaudacionReal.toFixed(2)}`;
            document.getElementById('kpi-egre').textContent = `$ ${d.kpis.egresos.toFixed(2)}`;
            document.getElementById('kpi-cart').textContent = `$ ${d.kpis.carteraPendiente.toFixed(2)}`;
            document.getElementById('kpi-neto').textContent = `$ ${d.kpis.disponibleNeto.toFixed(2)}`;

            document.getElementById('listaMetodos').innerHTML = d.metodos.map(m => `
                <div style="display:flex; justify-content:space-between; border-bottom:1px dashed rgba(0,0,0,0.1); padding-bottom:5px;">
                    <span>${m.Nombre}:</span> <span style="font-weight:900; color:var(--hotel-blue);">$ ${parseFloat(m.Total).toFixed(2)}</span>
                </div>
            `).join('');

            document.getElementById('listaArqueos').innerHTML = d.arqueos.map(a => {
                const dif = parseFloat(a.Diferencia || 0);
                return `
                    <div style="background:#f1f3f5; padding:15px; border-radius:15px; border-left:4px solid ${a.Estado ? 'var(--hotel-success)' : '#718096'};">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-size:0.75rem; font-weight:900; color:var(--hotel-blue);"><i class="fas fa-user"></i> ${a.Cajero}</span>
                            <button class="btn-neo" style="padding:4px 8px; font-size:0.65rem;" onclick="ReportesModule.imprimirCuadreFisico(${a.CajaID})"><i class="fas fa-print"></i> TICK</button>
                        </div>
                        <div style="display:flex; justify-content:space-between; margin-top:8px; font-size:0.7rem; font-weight:700;">
                            <span>Diferencia:</span> <span style="color:${dif < 0 ? 'var(--hotel-danger)' : 'var(--hotel-success)'}">$ ${dif.toFixed(2)}</span>
                        </div>
                    </div>
                `;
            }).join('');

            document.getElementById('tbAuditoria').innerHTML = d.auditoria.map(a => {
                const isIngreso = a.TipoMovimiento === 'Ingreso';
                const fecha = this.formatFecha(a.FechaMovimiento);
                
                let btnAnular = '';
                if (a.CierreMaestroID) {
                    btnAnular = `<span style="font-size:0.6rem; font-weight:bold; color:#718096;"><i class="fas fa-lock"></i> CERRADO</span>`;
                } else if (a.Observacion && a.Observacion.includes('[ADMIN]')) {
                    btnAnular = `<button type="button" class="btn-neo" style="padding:6px; color:var(--hotel-danger);" onclick="ReportesModule.solicitarAnulacion(${a.MovimientoID})"><i class="fas fa-trash-alt"></i></button>`;
                }

                const btnVoucher = a.ImagenVoucherPath ? `<button type="button" class="btn-neo" style="padding:6px 12px; color:#2980b9;" onclick="ReportesModule.verVoucherDigital('${a.ImagenVoucherPath}')"><i class="fas fa-image"></i> VER</button>` : '';
                const btnesEgreso = (!isIngreso && !a.ImagenVoucherPath) ? `
                    <button type="button" class="btn-neo" style="padding:6px 10px; color:var(--hotel-blue);" title="Generar comprobante de egreso (PDF, se guarda)" onclick="ReportesModule.generarComprobante(${a.MovimientoID})"><i class="fas fa-file-pdf"></i></button>
                    <button type="button" class="btn-neo" style="padding:6px 10px; color:#8e44ad;" title="Adjuntar factura real u otro respaldo" onclick="ReportesModule.adjuntarComprobante(${a.MovimientoID})"><i class="fas fa-paperclip"></i></button>
                ` : '';
                const tagOrigen = (a.Observacion.includes('CHECK-IN') || a.Observacion.includes('CHECK-OUT')) ? '<span class="badge bg-green">OPERATIVO</span>' : '<span class="badge bg-purple">ADMIN.</span>';

                return `
                    <tr>
                        <td style="font-size:0.75rem;">${fecha}</td>
                        <td>${tagOrigen}</td>
                        <td><strong style="color:var(--hotel-blue);">${(a.RubroNombre || a.Metodo).toUpperCase()}</strong><br><small style="color:#718096; font-size:0.65rem;">${a.Observacion}</small></td>
                        <td style="font-size:0.7rem;">${a.Responsable || 'SISTEMA'}</td>
                        <td style="text-align:right; font-weight:900; color:${isIngreso ? 'var(--hotel-success)' : 'var(--hotel-danger)'};">${isIngreso ? '+' : '-'} $ ${parseFloat(a.Monto).toFixed(2)}</td>
                        <td><div style="display:flex; gap:5px; align-items:center; flex-wrap:wrap;">${btnesEgreso} ${btnVoucher} ${btnAnular}</div></td>
                    </tr>
                `;
            }).join('');

        } catch (e) { console.error(e); }
    },

    generarComprobante(movimientoId) {
        generarYAbrirComprobante(movimientoId, document.title).then(() => this.cargarDashboard());
    },

    adjuntarComprobante(movimientoId) {
        subirComprobante(movimientoId, () => this.cargarDashboard());
    },

    // ==========================================
    // EJECUTAR CIERRE MAESTRO BANCARIO
    // ==========================================
    async ejecutarCierreMaestro() {
        if (!this.dashData || this.dashData.auditoria.length === 0) return Swal.fire('Sin datos', 'No hay movimientos para cerrar en este periodo.', 'warning');
        
        const confirm = await Swal.fire({
            title: '¿EJECUTAR CIERRE FINANCIERO?',
            html: `Se congelará la contabilidad del período seleccionado.<br><br><b>Neto a declarar:</b> $${this.dashData.kpis.disponibleNeto.toFixed(2)}`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: 'var(--hotel-danger)',
            confirmButtonText: '<i class="fas fa-lock"></i> Sí, Cerrar Período'
        });

        if (confirm.isConfirmed) {
            try {
                Swal.fire({ title: 'Procesando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                const res = await api.post('/reportes/cierre-maestro', { 
                    sedeId: this.getSedeId(), 
                    usuarioId: App.user.UsuarioID,
                    fechaInicio: document.getElementById('fechaInicioFinanzas').value,
                    fechaFin: document.getElementById('fechaFinFinanzas').value
                });

                if (res.data.success) {
                    await Swal.fire('CIERRE EXITOSO', 'Los movimientos han sido blindados.', 'success');
                    this.cargarDashboard();
                }
            } catch (err) { Swal.fire('Error', err.response?.data?.error || 'No se pudo generar el cierre', 'error'); }
        }
    },

    async cargarHistorialCierres() {
        const tb = document.getElementById('tbHistorialCierres');
        tb.innerHTML = '<tr><td colspan="7" style="text-align:center;">Cargando...</td></tr>';
        try {
            const res = await api.get(`/reportes/cierres-maestros/${this.getSedeId()}`);
            if(res.data.length === 0) return tb.innerHTML = '<tr><td colspan="7" style="text-align:center; opacity:0.5;">No hay cierres registrados.</td></tr>';
            
            tb.innerHTML = res.data.map(c => `
                <tr>
                    <td><b>#00${c.CierreID}</b></td>
                    <td>${this.formatFecha(c.FechaInicio, true)} al ${this.formatFecha(c.FechaFin, true)}</td>
                    <td>${c.Administrador}</td>
                    <td>$ ${parseFloat(c.TotalProduccion).toFixed(2)}</td>
                    <td style="color:var(--hotel-success);">$ ${parseFloat(c.TotalIngresos).toFixed(2)}</td>
                    <td style="color:var(--hotel-danger);">$ ${parseFloat(c.TotalEgresos).toFixed(2)}</td>
                    <td style="font-weight:900; color:var(--hotel-blue);">$ ${parseFloat(c.DisponibleNeto).toFixed(2)}</td>
                </tr>
            `).join('');
        } catch(e) { tb.innerHTML = '<tr><td colspan="7" style="color:red; text-align:center;">Error de carga</td></tr>'; }
    },

    // ==========================================
    // PDF CONSOLIDADO BANCARIO FULL
    // ==========================================
    async imprimirReporteConsolidado() {
        const fInicio = document.getElementById('fechaInicioFinanzas').value;
        const fFin = document.getElementById('fechaFinFinanzas').value;
        const selector = document.getElementById('globalSedeSelector');
        const sedeNombre = selector ? selector.options[selector.selectedIndex].text : 'SEDE PRINCIPAL';

        try {
            Swal.fire({ title: 'Generando Reporte Full...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            
            const resDeudores = await api.get(`/reportes/deudores/${this.getSedeId()}`);
            const resSRI = await api.post('/reportes/facturas/consolidado', { sedeId: this.getSedeId(), fechaInicio: fInicio, fechaFin: fFin });
            
            const d = this.dashData;
            Swal.close();

            const ventana = window.open('', '_blank');
            let html = `
            <!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Auditoría Financiera</title>
            <style>
                body { font-family: 'Arial', sans-serif; color: #333; margin: 0; padding: 20px; font-size: 11px; }
                .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px; }
                .section-title { background: #eee; padding: 6px; font-weight: bold; border-left: 4px solid #333; margin: 15px 0 10px 0; text-transform: uppercase; font-size:12px; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 15px; } th, td { border: 1px solid #ddd; padding: 6px; text-align: left; }
                th { background-color: #f4f4f4; text-transform: uppercase; } .text-right { text-align: right; } .text-success { color: green; } .text-danger { color: red; }
            </style></head><body>
                <div class="header"><h2>REPORTE FINANCIERO CONSOLIDADO Y AUDITORÍA BANCARIA</h2><p><b>${sedeNombre}</b> | Del ${fInicio} al ${fFin}</p><p>Generado: ${new Date().toLocaleString('es-EC')}</p></div>
                
                <div class="section-title">1. BALANCE GENERAL</div>
                <table><tr><th>Producción</th><th>Ingresos</th><th>Egresos</th><th>Cuentas x Cobrar</th><th>DISPONIBLE NETO</th></tr>
                <tr><td>$ ${d.kpis.produccionTotal.toFixed(2)}</td><td>$ ${d.kpis.recaudacionReal.toFixed(2)}</td><td>$ ${d.kpis.egresos.toFixed(2)}</td><td>$ ${d.kpis.carteraPendiente.toFixed(2)}</td><td style="font-weight:bold; font-size:14px;">$ ${d.kpis.disponibleNeto.toFixed(2)}</td></tr></table>

                <div class="section-title">2. INGRESO POR CUENTAS / MÉTODOS</div>
                <table><tr><th>Método</th><th class="text-right">Monto</th></tr>`;
            d.metodos.forEach(m => html += `<tr><td>${m.Nombre}</td><td class="text-right">$ ${parseFloat(m.Total).toFixed(2)}</td></tr>`);
            html += `</table>

                <div class="section-title">3. DEUDORES (CUENTAS POR COBRAR)</div>
                <table><tr><th>Huésped</th><th>Identificación</th><th>Fecha Ingreso</th><th>Deuda Total</th><th>Abonado</th><th>Saldo Pendiente</th></tr>`;
            if (resDeudores.data.length === 0) html += `<tr><td colspan="6" style="text-align:center;">Sin deudores</td></tr>`;
            else resDeudores.data.forEach(x => { const saldo = parseFloat(x.TotalHospedaje) - parseFloat(x.TotalAbonado); html += `<tr><td>${x.NombreFull}</td><td>${x.Documento}</td><td>${this.formatFecha(x.FechaEntrada, true)}</td><td>$ ${parseFloat(x.TotalHospedaje).toFixed(2)}</td><td>$ ${parseFloat(x.TotalAbonado).toFixed(2)}</td><td class="text-danger"><b>$ ${saldo.toFixed(2)}</b></td></tr>`; });
            html += `</table>

                <div class="section-title">4. FACTURACIÓN ELECTRÓNICA SRI</div>
                <table><tr><th>Secuencial</th><th>Fecha</th><th>Clave Acceso</th><th>Estado</th></tr>`;
            if (resSRI.data.length === 0) html += `<tr><td colspan="4" style="text-align:center;">Sin facturas emitidas</td></tr>`;
            else resSRI.data.forEach(x => html += `<tr><td>${x.Secuencial}</td><td>${this.formatFecha(x.FechaEmision, true)}</td><td>${x.ClaveAcceso}</td><td>${x.EstadoSRI}</td></tr>`);
            html += `</table>

                <div class="section-title">5. LIBRO MAYOR (AUDITORÍA DE MOVIMIENTOS)</div>
                <table><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Método</th><th>Responsable</th><th class="text-right">Monto</th></tr>`;
            d.auditoria.forEach(a => html += `<tr><td>${this.formatFecha(a.FechaMovimiento)}</td><td>${a.TipoMovimiento}</td><td>${a.RubroNombre || a.Observacion}</td><td>${a.Metodo || 'N/A'}</td><td>${a.Responsable}</td><td class="text-right ${a.TipoMovimiento==='Ingreso'?'text-success':'text-danger'}">${a.TipoMovimiento==='Ingreso'?'+':'-'} $ ${parseFloat(a.Monto).toFixed(2)}</td></tr>`);
            
            html += `</table><br><br><br>
            <div style="display:flex; justify-content:space-around; margin-top:50px; text-align:center;">
                <div>_________________________________<br>Firma Administrador</div>
                <div>_________________________________<br>Firma Auditor / Propietario</div>
            </div></body></html>`;

            ventana.document.write(html); ventana.document.close(); ventana.focus();
            setTimeout(() => { ventana.print(); ventana.close(); }, 500);
        } catch (err) { Swal.fire('Error', 'No se pudo generar PDF', 'error'); }
    },

    // ==========================================
    // IMPRIMIR TICKET DE ARQUEO FÍSICO
    // ==========================================
    async imprimirCuadreFisico(cajaId) {
        try {
            const res = await api.get(`/reportes/caja/detalle-cuadre/${cajaId}`);
            const d = res.data; const c = d.caja;
            let htmlCierre = `<div style="text-align:left; font-family:monospace; font-size:0.8rem;"><p><b>CAJERO:</b> ${c.Cajero}</p><p><b>APERTURA:</b> ${this.formatFecha(c.FechaApertura)}</p><p><b>APERTURA ($):</b> $${parseFloat(c.MontoApertura).toFixed(2)}</p><hr><p><b>RESUMEN:</b></p>`;
            d.resumen.forEach(r => htmlCierre += `<p>• <b>${r.Nombre}:</b> +$${parseFloat(r.Ingresos).toFixed(2)} / -$${parseFloat(r.Egresos).toFixed(2)}</p>`);
            htmlCierre += `<hr><p><b>CIERRE DECLARADO:</b> $${parseFloat(c.MontoCierre || 0).toFixed(2)}</p><p><b>DESFASE:</b> <span style="color:${c.Diferencia < 0 ? 'red' : 'green'}">$${parseFloat(c.Diferencia || 0).toFixed(2)}</span></p></div>`;
            Swal.fire({ title: `TICKET #00${cajaId}`, html: htmlCierre, icon: 'info', showCancelButton: true, confirmButtonText: '<i class="fas fa-print"></i> Enviar a Ticketera' })
                .then(r => { if(r.isConfirmed) window.Toast.fire({ icon: 'success', title: 'Imprimiendo...' }); });
        } catch (e) { Swal.fire('Error', 'Fallo ticket', 'error'); }
    },

    verVoucherDigital(path) {
        const baseUrl = api.defaults && api.defaults.baseURL ? api.defaults.baseURL.replace(/\/api$/, '') : 'http://localhost:4000';
        document.getElementById('imgVisorDestino').src = `${baseUrl}/uploads/${path}`;
        document.getElementById('modalVisorVoucher').classList.remove('hidden');
    },

    // ==========================================
    // REGISTRO DE MOVIMIENTOS GLOBALES
    // ==========================================
    abrirModalRegistroMovimiento() {
        document.getElementById('formNuevoMovimiento').reset();
        this.filtrarRubrosForm();
        document.getElementById('modalRegistroMovimiento').classList.remove('hidden');
    },

    async guardarMovimientoManual(e) {
        e.preventDefault();
        const tipoVal = document.getElementById('movTipo').value;
        const referenciaVal = document.getElementById('movReferencia').value.trim();
        const fileInput = document.getElementById('movVoucherFile');
        const tieneVoucher = fileInput && fileInput.files[0];

        if (tipoVal === 'Egreso' && !tieneVoucher && !referenciaVal) {
            return Swal.fire('Falta el sustento', 'Todo egreso debe respaldarse: adjunte la foto del comprobante o indique la referencia (Nro. de documento).', 'warning');
        }

        const formData = new FormData();
        formData.append('tipo', tipoVal);
        formData.append('metodoId', document.getElementById('movMetodo').value);
        formData.append('rubroId', document.getElementById('movRubro').value);
        formData.append('monto', document.getElementById('movMonto').value);
        formData.append('observacion', document.getElementById('movObs').value);
        formData.append('referencia', referenciaVal);

        if(tieneVoucher) formData.append('voucher', fileInput.files[0]);

        try {
            Swal.fire({ title: 'Afectando Fondo...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const res = await api.post('/reportes/movimiento/manual', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
            if (res.data.success) {
                await Swal.fire('LISTO', 'Asiento guardado en la cuenta central.', 'success');
                document.getElementById('modalRegistroMovimiento').classList.add('hidden');
                this.cargarDashboard();
            }
        } catch (err) { Swal.fire('Error', err.response?.data?.error, 'error'); }
    },

    solicitarAnulacion(movId) {
        document.getElementById('seguridadMovId').value = movId;
        document.getElementById('seguridadPassword').value = '';
        document.getElementById('modalSeguridadAnulacion').classList.remove('hidden');
        setTimeout(() => document.getElementById('seguridadPassword').focus(), 120);
    },

    async procesarAnulacionSegura(e) {
        e.preventDefault();
        try {
            const res = await api.post('/reportes/movimiento/anular-seguro', { 
                movimientoId: document.getElementById('seguridadMovId').value, 
                adminUsuarioId: App.user.UsuarioID, 
                adminPassword: document.getElementById('seguridadPassword').value 
            });
            if (res.data.success) {
                window.Toast.fire({ icon: 'success', title: 'Eliminado' });
                document.getElementById('modalSeguridadAnulacion').classList.add('hidden');
                this.cargarDashboard();
            }
        } catch (err) {
            document.getElementById('seguridadPassword').value = '';
            Swal.fire('DENEGADO', err.response?.data?.error, 'error');
        }
    },

    renderRubrosLista() {
        const list = document.getElementById('listaRubrosContables');
        if(!list) return;
        list.innerHTML = this.rubrosCache.map(r => `<div style="display:flex; justify-content:space-between; align-items:center; background:#f1f3f5; padding:12px 20px; border-radius:15px; margin-bottom:10px; border-left:4px solid ${r.Tipo === 'Ingreso' ? 'var(--hotel-success)' : 'var(--hotel-danger)'};"><div><span style="font-weight:900; color:var(--hotel-blue);">${r.Nombre}</span><span style="display:block; font-size:0.6rem; color:#718096; font-weight:800; text-transform:uppercase;">Naturaleza: ${r.Tipo}</span></div></div>`).join('');
    },

    async guardarNuevoRubro(e) {
        e.preventDefault();
        try {
            const res = await api.post('/reportes/rubros', { Nombre: document.getElementById('rubroNombre').value, Tipo: document.getElementById('rubroTipo').value, SedeID: this.getSedeId() });
            if (res.data.success) {
                window.Toast.fire({ icon: 'success', title: 'Rubro Guardado' });
                document.getElementById('formNuevoRubro').reset();
                const r = await api.get('/reportes/rubros');
                this.rubrosCache = r.data || [];
                this.renderRubrosLista(); this.filtrarRubrosForm();
            }
        } catch (err) { Swal.fire('Error', 'No se pudo crear', 'error'); }
    },

    // ==========================================
    // DEUDORES (CUENTAS POR COBRAR) - ACTUALIZADO CON BOTÓN DE COBRO
    // ==========================================
    async cargarDeudores() {
        try {
            const res = await api.get(`/reportes/deudores/${this.getSedeId()}`);
            if (res.data.length === 0) {
                document.getElementById('tbDeudores').innerHTML = '<tr><td colspan="9" style="text-align:center;">Sin deudores</td></tr>';
                return;
            }

            document.getElementById('tbDeudores').innerHTML = res.data.map(d => {
                const saldo = parseFloat(d.TotalHospedaje) - parseFloat(d.TotalAbonado);
                return `
                <tr>
                    <td><b>#00${d.RecepcionID}</b></td>
                    <td style="color:var(--hotel-blue);">${d.NombreFull}</td>
                    <td>${d.Documento}</td>
                    <td>Hab. ${d.NroHabitacion || 'N/A'}</td>
                    <td>${this.formatFecha(d.FechaEntrada, true)}</td>
                    <td>$ ${parseFloat(d.TotalHospedaje).toFixed(2)}</td>
                    <td style="color:var(--hotel-success);">$ ${parseFloat(d.TotalAbonado).toFixed(2)}</td>
                    <td style="color:var(--hotel-danger); font-weight:900;">$ ${saldo.toFixed(2)}</td>
                    <td>
                        <button class="btn-neo" style="padding:5px 10px; font-size:0.7rem; background:var(--hotel-success); color:white; border:none;" 
                                onclick="ReportesModule.cobrarDeuda(${d.RecepcionID}, ${saldo})">
                            <i class="fas fa-hand-holding-usd"></i> COBRAR
                        </button>
                    </td>
                </tr>`;
            }).join('');
        } catch(e) {
            console.error("Error cargando deudores:", e);
        }
    },

    async cobrarDeuda(recepcionId, saldoPendiente) {
        const user = App.user || JSON.parse(localStorage.getItem('user'));
        const sedeId = this.getSedeId();
        
        let cajaId = null;
        try {
            const resCaja = await api.get(`/caja/estado/${user.UsuarioID}/${sedeId}`);
            if (!resCaja.data.abierta) {
                return Swal.fire({icon: 'error', title: 'CAJA CERRADA', text: 'Debe abrir su turno de caja para poder registrar el ingreso de este cobro.'});
            }
            cajaId = resCaja.data.caja.CajaID;
        } catch(e) { return Swal.fire('Error', 'No se pudo verificar el estado de la caja', 'error'); }

        const { value: formValues } = await Swal.fire({
            title: `COBRAR FOLIO #00${recepcionId}`,
            html: `
                <label style="font-size:0.8rem; font-weight:bold; color:var(--hotel-blue); display:block; text-align:left; margin-bottom:5px;">Monto a Cobrar (Máx $${saldoPendiente.toFixed(2)})</label>
                <input id="swal-monto" type="number" step="0.01" class="swal2-input" value="${saldoPendiente.toFixed(2)}" style="margin-bottom:15px; color:var(--hotel-success); font-weight:bold;">
                
                <label style="font-size:0.8rem; font-weight:bold; color:var(--hotel-blue); display:block; text-align:left; margin-bottom:5px;">Método de Pago</label>
                <select id="swal-metodo" class="swal2-input" style="margin-bottom:15px;" onchange="document.getElementById('box-voucher-abono').style.display = (this.value == '2' || this.value == '3') ? 'block' : 'none'">
                    <option value="1">EFECTIVO</option>
                    <option value="2">TRANSFERENCIA</option>
                    <option value="3">TARJETA</option>
                </select>
                
                <label style="font-size:0.8rem; font-weight:bold; color:var(--hotel-blue); display:block; text-align:left; margin-bottom:5px;">Referencia (Opcional)</label>
                <input id="swal-ref" type="text" class="swal2-input" placeholder="Lote / Nro. Comprobante" style="margin-bottom:15px;">

                <div id="box-voucher-abono" style="display:none; text-align:left;">
                    <label style="font-size:0.8rem; font-weight:bold; color:var(--hotel-blue); display:block; margin-bottom:5px;">Foto del Comprobante</label>
                    <input id="swal-voucher" type="file" class="swal2-file" accept="image/*,application/pdf">
                </div>
            `,
            didOpen: () => { document.getElementById('swal-metodo').dispatchEvent(new Event('change')); },
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: '<i class="fas fa-check-circle"></i> PROCESAR PAGO',
            cancelButtonText: 'CANCELAR',
            confirmButtonColor: 'var(--hotel-success)',
            background: 'var(--hotel-bg)',
            preConfirm: () => {
                const monto = parseFloat(document.getElementById('swal-monto').value);
                const metodo = document.getElementById('swal-metodo').value;
                const ref = document.getElementById('swal-ref').value;
                const voucherFile = document.getElementById('swal-voucher').files[0];
                
                if (!monto || monto <= 0) { Swal.showValidationMessage('Ingrese un monto válido'); return false; }
                if (monto > saldoPendiente) { Swal.showValidationMessage('El cobro no puede superar la deuda'); return false; }
                
                return { monto, metodoId: metodo, referencia: ref, voucherFile };
            }
        });

        if (formValues) {
            try {
                const formData = new FormData();
                formData.append('recepcionId', recepcionId);
                formData.append('cajaId', cajaId);
                formData.append('monto', formValues.monto);
                formData.append('metodoId', formValues.metodoId);
                formData.append('referencia', formValues.referencia);
                if (formValues.voucherFile) formData.append('voucher', formValues.voucherFile);

                const res = await api.post('/recepcion/abono', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
                
                if (res.data.success) {
                    window.Toast.fire({ icon: 'success', title: 'DEUDA COBRADA' });
                    await this.cargarDashboard();
                    await this.cargarDeudores();
                }
            } catch (err) {
                Swal.fire({icon: 'error', title: 'ERROR', text: err.response?.data?.error || 'Fallo al procesar cobro'});
            }
        }
    },

    async cargarConsolidadoSRI() {
        try {
            const res = await api.post('/reportes/facturas/consolidado', { sedeId: this.getSedeId(), fechaInicio: document.getElementById('fechaInicioFinanzas').value, fechaFin: document.getElementById('fechaFinFinanzas').value });
            document.getElementById('tbSRI').innerHTML = res.data.length === 0 ? '<tr><td colspan="6" style="text-align:center;">Sin facturas</td></tr>' : res.data.map(f => `<tr><td><b>${f.Secuencial}</b></td><td>${f.Sede.toUpperCase()}</td><td>${f.Emisor}</td><td>${this.formatFecha(f.FechaEmision, true)}</td><td style="font-family:monospace; font-size:0.7rem;">${f.ClaveAcceso}</td><td><span class="badge bg-green">${f.EstadoSRI}</span></td></tr>`).join('');
        } catch(e) {}
    },

    setupEventListeners() {
        document.getElementById('formNuevoRubro').onsubmit = (e) => this.guardarNuevoRubro(e);
        document.getElementById('formNuevoMovimiento').onsubmit = (e) => this.guardarMovimientoManual(e);
        document.getElementById('formSeguridad').onsubmit = (e) => this.procesarAnulacionSegura(e);
    }
};

module.exports = ReportesModule;