const api = require('./api');
const { marcarBuscando } = require('./uiLoading');

const RetencionesModule = {
    impuestos: [],
    codigosCache: [],
    itemsLiquidacion: [],
    proveedoresCache: [],

    async init() {
        console.log("📡 Módulo de Retenciones Iniciado (dentro de Facturación)...");
        // El selector de sede es el de Facturación (#globalSedeSelector) — getSedeId() ya lo lee de ahí.
        await this.cargarCodigos();
        await this.cargarHistorial();
        await this.cargarProveedoresCache();
        window.RetencionesModule = this;
    },

    getSedeId() {
        const selector = document.getElementById('globalSedeSelector');
        if (selector) return selector.value;
        const user = JSON.parse(localStorage.getItem('user'));
        return localStorage.getItem('currentSedeId') || (user ? user.SedeID : 1);
    },

    switchTab(tab) {
        const tabs = { emitir: 'retTabEmitir', historial: 'retTabHistorial', compras: 'retTabCompras', liquidacion: 'retTabLiquidacion', proveedores: 'retTabProveedores', codigos: 'retTabCodigos' };
        const btns = { emitir: 'retBtnTabEmitir', historial: 'retBtnTabHistorial', compras: 'retBtnTabCompras', liquidacion: 'retBtnTabLiquidacion', proveedores: 'retBtnTabProveedores', codigos: 'retBtnTabCodigos' };

        Object.keys(tabs).forEach(t => {
            const el = document.getElementById(tabs[t]);
            const btn = document.getElementById(btns[t]);
            if (el) el.classList.toggle('hidden', t !== tab);
            if (btn) btn.classList.toggle('active', t === tab);
        });

        if (tab === 'historial') this.cargarHistorial();
        if (tab === 'compras') { this.cargarCompras(); this.cargarMetodosYRubrosCompra(); }
        if (tab === 'liquidacion') this.cargarHistorialLiquidacion();
        if (tab === 'proveedores') this.buscarProveedores();
        if (tab === 'codigos') this.cargarCodigos();
    },

    // ══════════════════ EMITIR RETENCIÓN ══════════════════

    async cargarCodigos() {
        try {
            const res = await api.get('/codigosretencion');
            this.codigosCache = res.data.codigos || [];

            const select = document.getElementById('retSelectCodigo');
            if (select) {
                select.innerHTML = '<option value="">-- Seleccionar --</option>' +
                    this.codigosCache.map(c => `<option value="${c.CodigoRetencionID}">${c.Tipo} ${c.Codigo} — ${c.Descripcion} (${c.PorcentajeDefault}%)</option>`).join('');
            }

            const tabla = document.getElementById('crTablaBody');
            if (tabla) {
                tabla.innerHTML = this.codigosCache.length
                    ? this.codigosCache.map(c => `
                        <tr>
                            <td>${c.Tipo}</td><td>${c.Codigo}</td><td>${c.Descripcion}</td><td>${c.PorcentajeDefault}%</td>
                            <td><button class="btn-neo btn-danger" style="padding:8px 12px;" onclick="RetencionesModule.eliminarCodigo(${c.CodigoRetencionID})"><i class="fas fa-trash"></i></button></td>
                        </tr>
                    `).join('')
                    : '<tr><td colspan="5" style="text-align:center; opacity:0.5;">Sin códigos registrados.</td></tr>';
            }
        } catch (err) {
            console.error('Error cargando códigos de retención:', err);
        }
    },

    autoLlenarCodigo() {
        const id = parseInt(document.getElementById('retSelectCodigo').value);
        const codigo = this.codigosCache.find(c => c.CodigoRetencionID === id);
        if (codigo) document.getElementById('retDetPct').value = codigo.PorcentajeDefault;
    },

    agregarImpuesto() {
        const select = document.getElementById('retSelectCodigo');
        const id = parseInt(select.value);
        const codigo = this.codigosCache.find(c => c.CodigoRetencionID === id);
        if (!codigo) return Swal.fire('Falta el código', 'Seleccione un código de retención.', 'warning');

        const base = parseFloat(document.getElementById('retDetBase').value);
        const pct  = parseFloat(document.getElementById('retDetPct').value);
        if (!base || base <= 0) return Swal.fire('Base inválida', 'La base imponible debe ser mayor a 0.', 'warning');
        if (pct === undefined || isNaN(pct)) return Swal.fire('Porcentaje inválido', 'Indique el porcentaje a retener.', 'warning');

        this.impuestos.push({
            TipoImpuesto: codigo.Tipo, CodigoRetencion: codigo.Codigo,
            Descripcion: codigo.Descripcion, BaseImponible: base, PorcentajeRetener: pct
        });

        document.getElementById('retDetBase').value = '';
        document.getElementById('retDetPct').value = '';
        select.value = '';
        this.renderImpuestos();
    },

    quitarImpuesto(index) {
        this.impuestos.splice(index, 1);
        this.renderImpuestos();
    },

    renderImpuestos() {
        const body = document.getElementById('retTablaImpuestosBody');
        if (!this.impuestos.length) {
            body.innerHTML = '<tr><td colspan="6" style="text-align:center; opacity:0.5;">Sin impuestos agregados</td></tr>';
        } else {
            body.innerHTML = this.impuestos.map((imp, i) => {
                const retenido = (imp.BaseImponible * imp.PorcentajeRetener / 100).toFixed(2);
                return `
                    <tr>
                        <td>${imp.TipoImpuesto}</td>
                        <td>${imp.CodigoRetencion}</td>
                        <td>$${imp.BaseImponible.toFixed(2)}</td>
                        <td>${imp.PorcentajeRetener}%</td>
                        <td>$${retenido}</td>
                        <td><button class="btn-neo btn-danger" style="padding:8px 12px;" onclick="RetencionesModule.quitarImpuesto(${i})"><i class="fas fa-trash"></i></button></td>
                    </tr>
                `;
            }).join('');
        }
        const total = this.impuestos.reduce((acc, imp) => acc + (imp.BaseImponible * imp.PorcentajeRetener / 100), 0);
        document.getElementById('retTotalGeneral').textContent = total.toFixed(2);
    },

    async emitir() {
        const documento = document.getElementById('retProvDocumento').value.trim();
        const razonSocial = document.getElementById('retProvRazonSocial').value.trim();
        const periodoFiscal = document.getElementById('retPeriodoFiscal').value.trim();
        const numDocSustento = document.getElementById('retNumDocSustento').value.trim();
        const fechaDocSustento = document.getElementById('retFechaDocSustento').value;

        if (!documento || !razonSocial) return Swal.fire('Faltan datos', 'Documento y Razón Social del proveedor son obligatorios.', 'warning');
        if (!/^\d{2}\/\d{4}$/.test(periodoFiscal)) return Swal.fire('Período inválido', 'El período fiscal debe tener formato MM/YYYY.', 'warning');
        if (!numDocSustento || !fechaDocSustento) return Swal.fire('Faltan datos', 'Complete el número y fecha de la factura del proveedor.', 'warning');
        if (!this.impuestos.length) return Swal.fire('Sin impuestos', 'Agregue al menos un impuesto a retener.', 'warning');

        const user = JSON.parse(localStorage.getItem('user'));
        const payload = {
            SedeID: this.getSedeId(),
            UsuarioID: user ? user.UsuarioID : 1,
            Proveedor: {
                Documento: documento,
                TipoIdentificacion: documento.length === 13 ? '04' : '05',
                RazonSocial: razonSocial,
                Correo: document.getElementById('retProvCorreo').value.trim() || null,
                Telefono: document.getElementById('retProvTelefono').value.trim() || null
            },
            PeriodoFiscal: periodoFiscal,
            NumDocSustento: numDocSustento,
            FechaDocSustento: fechaDocSustento,
            Impuestos: this.impuestos.map(i => ({ TipoImpuesto: i.TipoImpuesto, CodigoRetencion: i.CodigoRetencion, BaseImponible: i.BaseImponible, PorcentajeRetener: i.PorcentajeRetener }))
        };

        try {
            Swal.fire({ title: 'Generando Comprobante de Retención...', text: 'Firmando XML e interactuando con SRI...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const res = await api.post('/retenciones/emitir', payload);
            if (res.data.success) {
                await Swal.fire({ title: '¡RETENCIÓN EMITIDA!', text: `SRI: ${res.data.estadoSRI} | Acceso: ${res.data.claveAcceso}`, icon: 'success', confirmButtonColor: 'var(--hotel-blue)' });
                this.resetFormulario();
                await this.cargarHistorial();
                await this.cargarProveedoresCache();
            }
        } catch (err) {
            Swal.fire({ icon: 'error', title: 'No se pudo emitir', text: err.response?.data?.error || 'Error desconocido' });
        }
    },

    resetFormulario() {
        this.impuestos = [];
        ['retProvSelect','retProvDocumento','retProvRazonSocial','retProvCorreo','retProvTelefono','retPeriodoFiscal','retNumDocSustento','retFechaDocSustento']
            .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        this.renderImpuestos();
    },

    // ══════════════════ HISTORIAL ══════════════════

    async cargarHistorial() {
        try {
            const res = await api.get(`/retenciones/historial/${this.getSedeId()}`);
            this.historialRetencionCache = res.data || [];
            this.renderHistorial();
        } catch (err) {
            console.error('Error cargando historial de retenciones:', err);
        }
    },

    renderHistorial() {
        const body = document.getElementById('retTablaHistorialBody');
        if (!body) return;
        const buscar = (document.getElementById('retHistorialBuscar')?.value || '').trim().toLowerCase();
        const base = this.historialRetencionCache || [];
        const lista = buscar
            ? base.filter(r => (r.ProveedorNombre || '').toLowerCase().includes(buscar) || (r.ProveedorDocumento || '').toLowerCase().includes(buscar) || (r.Secuencial || '').toLowerCase().includes(buscar))
            : base;

        if (!lista.length) {
            body.innerHTML = `<tr><td colspan="6" style="text-align:center; opacity:0.5;">${buscar ? `Sin resultados para "${buscar}".` : 'Sin retenciones emitidas.'}</td></tr>`;
            return;
        }
        body.innerHTML = lista.map(r => {
            const badgeClass = r.EstadoSRI === 'AUTORIZADO' ? 'badge-autorizado'
                : r.EstadoSRI === 'FIRMADO' ? 'badge-firmado'
                : r.EstadoSRI === 'RECHAZADO' ? 'badge-rechazado' : 'badge-pendiente';
            return `
                <tr>
                    <td>${r.Secuencial}</td>
                    <td>${r.ProveedorNombre}<br><small style="opacity:0.6;">${r.ProveedorDocumento || ''}</small></td>
                    <td>${r.PeriodoFiscal}</td>
                    <td>$${parseFloat(r.TotalRetenido).toFixed(2)}</td>
                    <td><span class="badge-sri ${badgeClass}">${r.EstadoSRI || 'PENDIENTE'}</span></td>
                    <td>
                        <button class="btn-neo" style="padding:8px 12px;" title="Ver RIDE" onclick="RetencionesModule.verRIDE(${r.RetencionID})"><i class="fas fa-file-pdf"></i></button>
                        <button class="btn-neo" style="padding:8px 12px;" title="Enviar correo" onclick="RetencionesModule.enviarCorreo(${r.RetencionID})"><i class="fas fa-envelope"></i></button>
                    </td>
                </tr>
            `;
        }).join('');
    },

    async verRIDE(retencionId) {
        try {
            const res = await api.get(`/retenciones/documento/ride/${retencionId}`);
            if (res.data.success) {
                const base = api.defaults.baseURL.replace(/\/api\/?$/, '');
                window.open(`${base}${res.data.pdfUrl}`, '_blank');
            }
        } catch (err) {
            Swal.fire('Error', err.response?.data?.error || 'No se pudo generar el RIDE.', 'error');
        }
    },

    async enviarCorreo(retencionId) {
        const { value: correo } = await Swal.fire({
            title: 'Enviar Comprobante de Retención',
            input: 'email',
            inputPlaceholder: 'correo@ejemplo.com',
            showCancelButton: true,
            confirmButtonText: 'Enviar'
        });
        if (!correo) return;
        try {
            Swal.fire({ title: 'Enviando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            await api.post('/retenciones/documento/enviar-correo', { retencionId, correoDestino: correo });
            await Swal.fire('Enviado', 'El correo fue enviado correctamente.', 'success');
        } catch (err) {
            Swal.fire('Error', err.response?.data?.error || 'No se pudo enviar el correo.', 'error');
        }
    },

    // ══════════════════ SELECTOR DE PROVEEDOR (compartido: Emitir Retención + Compras) ══════════════════

    async cargarProveedoresCache() {
        try {
            const res = await api.get('/proveedores');
            this.proveedoresCache = res.data.proveedores || [];
            const opciones = '<option value="">-- Nuevo proveedor (ingrese los datos abajo) --</option>' +
                this.proveedoresCache.map(p => `<option value="${p.ProveedorID}">${p.RazonSocial} — ${p.Documento}</option>`).join('');
            ['retProvSelect', 'cpProvSelect', 'lcProvSelect'].forEach(id => {
                const sel = document.getElementById(id);
                if (sel) sel.innerHTML = opciones;
            });
        } catch (err) {
            console.error('Error cargando caché de proveedores:', err);
        }
    },

    seleccionarProveedor(prefix, proveedorId) {
        const map = { ret: 'retProv', cp: 'cpProv', lc: 'lcProv' };
        const p = this.proveedoresCache.find(x => x.ProveedorID === parseInt(proveedorId));
        const base = map[prefix];
        if (!p) {
            ['Documento','RazonSocial','Correo','Telefono'].forEach(campo => {
                const el = document.getElementById(`${base}${campo}`);
                if (el) el.value = '';
            });
            return;
        }
        const setVal = (campo, valor) => { const el = document.getElementById(`${base}${campo}`); if (el) el.value = valor || ''; };
        setVal('Documento', p.Documento);
        setVal('RazonSocial', p.RazonSocial);
        setVal('Correo', p.Correo);
        setVal('Telefono', p.Telefono);
    },

    async autoLlenarProveedorPorDocumento(prefix) {
        const map = { ret: 'retProv', cp: 'cpProv', lc: 'lcProv' };
        const base = map[prefix];
        const inputDoc = document.getElementById(`${base}Documento`);
        const doc = inputDoc.value.trim();
        if (!doc) return;

        const enCache = this.proveedoresCache.find(p => p.Documento === doc);
        if (enCache) {
            const sel = document.getElementById(`${prefix}ProvSelect`);
            if (sel) sel.value = enCache.ProveedorID;
            this.seleccionarProveedor(prefix, enCache.ProveedorID);
            return;
        }

        marcarBuscando(inputDoc, true);
        try {
            const res = await api.get(`/proveedores/documento/${doc}`);
            if (res.data.success) {
                const el = document.getElementById(`${base}RazonSocial`);
                if (el) el.value = res.data.proveedor.RazonSocial;
                if (res.data.source === 'padron') {
                    window.Toast.fire({ icon: 'success', title: 'DATOS OBTENIDOS DEL PADRÓN NACIONAL' });
                }
            }
        } catch (_) { /* proveedor nuevo — se auto-crea al registrar */ }
        finally {
            marcarBuscando(inputDoc, false);
        }
    },

    // ══════════════════ COMPRAS / GASTOS ══════════════════

    calcularTotalCompra() {
        const base  = parseFloat(document.getElementById('cpBaseImponible').value)  || 0;
        const base0 = parseFloat(document.getElementById('cpBaseImponible0').value) || 0;
        const iva   = parseFloat(document.getElementById('cpIva').value)            || 0;
        document.getElementById('cpTotal').textContent = (base + base0 + iva).toFixed(2);
    },

    togglePagoCompra() {
        const activo = document.getElementById('cpRegistrarPago').checked;
        document.getElementById('cpPagoCampos').style.display = activo ? 'flex' : 'none';
    },

    async cargarMetodosYRubrosCompra() {
        try {
            const [resMetodos, resRubros] = await Promise.all([
                api.get('/reportes/metodos-pago'),
                api.get('/reportes/rubros')
            ]);
            this.metodosPagoCache = resMetodos.data || [];
            this.rubrosEgresoCache = (resRubros.data || []).filter(r => r.Tipo === 'Egreso');

            const selMetodo = document.getElementById('cpMetodoPago');
            if (selMetodo) {
                selMetodo.innerHTML = this.metodosPagoCache.map(m => `<option value="${m.MetodoID}">${m.Nombre}</option>`).join('');
            }
            const selRubro = document.getElementById('cpRubro');
            if (selRubro) {
                selRubro.innerHTML = this.rubrosEgresoCache.map(r => `<option value="${r.RubroID}" ${r.Nombre.includes('Compra de Insumos') ? 'selected' : ''}>${r.Nombre}</option>`).join('');
            }
        } catch (err) {
            console.error('Error cargando métodos/rubros:', err);
        }
    },

    async cargarCompras() {
        const buscar = document.getElementById('cpBuscar')?.value.trim() || '';
        try {
            const res = await api.get(`/compras/${this.getSedeId()}`, { params: { buscar } });
            const body = document.getElementById('cpTablaBody');
            if (!body) return;
            const lista = res.data.compras || [];
            if (!lista.length) {
                body.innerHTML = '<tr><td colspan="7" style="text-align:center; opacity:0.5;">Sin compras registradas.</td></tr>';
                return;
            }
            body.innerHTML = lista.map(c => {
                const declarable = c.Autorizacion && String(c.Autorizacion).trim();
                const badgeAts = declarable
                    ? '<span class="badge-sri badge-autorizado">DECLARA</span>'
                    : '<span class="badge-sri badge-pendiente" title="Sin número de autorización SRI">S/COMPROB.</span>';
                const pago = c.MovimientoID
                    ? `<span class="badge-sri badge-autorizado" title="Movimiento #${c.MovimientoID}">${c.MetodoPagoNombre || 'PAGADO'}</span>`
                    : `<span class="badge-sri badge-pendiente">PENDIENTE</span>
                       <button class="btn-neo" style="padding:6px 10px; margin-left:5px; color:var(--hotel-success);" title="Marcar como pagada" onclick="RetencionesModule.marcarCompraPagada(${c.CompraID})"><i class="fas fa-money-check-alt"></i></button>`;
                return `
                <tr>
                    <td>${c.ProveedorNombre}<br><small style="opacity:0.6;">${c.ProveedorDocumento}</small></td>
                    <td>${c.Establecimiento}-${c.PuntoEmision}-${c.Secuencial}</td>
                    <td>${this.formatFecha ? this.formatFecha(c.FechaEmision) : String(c.FechaEmision).substring(0,10)}</td>
                    <td>$${parseFloat(c.Total).toFixed(2)}</td>
                    <td>${badgeAts}</td>
                    <td>${pago}</td>
                    <td><button class="btn-neo btn-danger" style="padding:8px 12px;" onclick="RetencionesModule.eliminarCompra(${c.CompraID})"><i class="fas fa-trash"></i></button></td>
                </tr>
            `;
            }).join('');
        } catch (err) {
            console.error('Error cargando compras:', err);
        }
    },

    async marcarCompraPagada(compraId) {
        if (!this.metodosPagoCache || !this.metodosPagoCache.length) {
            await this.cargarMetodosYRubrosCompra();
        }
        const optsMetodo = this.metodosPagoCache.map(m => `<option value="${m.MetodoID}">${m.Nombre}</option>`).join('');
        const optsRubro = this.rubrosEgresoCache.map(r => `<option value="${r.RubroID}" ${r.Nombre.includes('Compra de Insumos') ? 'selected' : ''}>${r.Nombre}</option>`).join('');

        const { value: formValues } = await Swal.fire({
            title: 'Marcar Compra como Pagada',
            html: `
                <label class="label-hint" style="text-align:left;">¿De dónde salió el dinero?</label>
                <select id="swMetodoPago" class="swal2-select" style="display:block; width:100%; margin-bottom:12px;">${optsMetodo}</select>
                <label class="label-hint" style="text-align:left;">Rubro Contable</label>
                <select id="swRubro" class="swal2-select" style="display:block; width:100%;">${optsRubro}</select>
            `,
            showCancelButton: true,
            confirmButtonText: 'Registrar Pago',
            preConfirm: () => ({
                MetodoPagoID: parseInt(document.getElementById('swMetodoPago').value),
                RubroID: parseInt(document.getElementById('swRubro').value)
            })
        });
        if (!formValues) return;

        try {
            await api.post(`/compras/${compraId}/marcar-pagada`, formValues);
            window.Toast.fire({ icon: 'success', title: 'Compra marcada como pagada' });
            this.cargarCompras();
        } catch (err) {
            Swal.fire('Error', err.response?.data?.error || 'No se pudo registrar el pago.', 'error');
        }
    },

    async registrarCompra() {
        const documento = document.getElementById('cpProvDocumento').value.trim();
        const razonSocial = document.getElementById('cpProvRazonSocial').value.trim();
        const numeroComprobante = document.getElementById('cpNumeroComprobante').value.trim();
        const fechaEmision = document.getElementById('cpFechaEmision').value;

        if (!documento || !razonSocial) return Swal.fire('Faltan datos', 'Documento y Razón Social del proveedor son obligatorios.', 'warning');
        if (!numeroComprobante || !fechaEmision) return Swal.fire('Faltan datos', 'Complete el número de comprobante y la fecha de emisión.', 'warning');

        const registrarPago = document.getElementById('cpRegistrarPago').checked;
        if (registrarPago && !document.getElementById('cpMetodoPago').value) {
            return Swal.fire('Falta el método de pago', 'Indique de dónde salió el dinero (efectivo, banco, etc.) o desmarque "¿Ya se pagó?".', 'warning');
        }

        const user = JSON.parse(localStorage.getItem('user'));
        const payload = {
            SedeID: this.getSedeId(),
            UsuarioID: user ? user.UsuarioID : 1,
            Proveedor: {
                Documento: documento,
                TipoIdentificacion: documento.length === 13 ? '04' : '05',
                RazonSocial: razonSocial
            },
            TipoComprobante: document.getElementById('cpTipoComprobante').value,
            NumeroComprobante: numeroComprobante,
            Autorizacion: document.getElementById('cpAutorizacion').value.trim() || null,
            FechaEmision: fechaEmision,
            BaseImponible: parseFloat(document.getElementById('cpBaseImponible').value) || 0,
            BaseImponible0: parseFloat(document.getElementById('cpBaseImponible0').value) || 0,
            IVA: parseFloat(document.getElementById('cpIva').value) || 0,
            ValorRetencionIva: parseFloat(document.getElementById('cpRetIva').value) || 0,
            ValorRetencionRenta: parseFloat(document.getElementById('cpRetRenta').value) || 0,
            FormaPago: document.getElementById('cpFormaPago').value,
            SustentoTributario: document.getElementById('cpSustento').value,
            RegistrarPago: registrarPago,
            MetodoPagoID: registrarPago ? parseInt(document.getElementById('cpMetodoPago').value) : null,
            RubroID: registrarPago ? parseInt(document.getElementById('cpRubro').value) : null
        };

        try {
            await api.post('/compras', payload);
            window.Toast.fire({ icon: 'success', title: 'Compra registrada' });
            ['cpProvSelect','cpProvDocumento','cpProvRazonSocial','cpNumeroComprobante','cpAutorizacion','cpFechaEmision','cpBaseImponible','cpBaseImponible0','cpIva','cpRetIva','cpRetRenta']
                .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
            document.getElementById('cpTotal').textContent = '0.00';
            this.cargarCompras();
            this.cargarProveedoresCache();
        } catch (err) {
            Swal.fire('Error', err.response?.data?.error || 'No se pudo registrar la compra.', 'error');
        }
    },

    async eliminarCompra(id) {
        const confirm = await Swal.fire({ title: '¿Eliminar compra?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí, eliminar' });
        if (!confirm.isConfirmed) return;
        try {
            await api.delete(`/compras/${id}`);
            this.cargarCompras();
        } catch (err) {
            Swal.fire('Error', err.response?.data?.error || 'No se pudo eliminar.', 'error');
        }
    },

    // ══════════════════ PROVEEDORES ══════════════════

    async buscarProveedores() {
        const buscar = document.getElementById('pvBuscar')?.value.trim() || '';
        try {
            const res = await api.get('/proveedores', { params: { buscar } });
            const body = document.getElementById('pvTablaBody');
            const lista = res.data.proveedores || [];
            if (!lista.length) {
                body.innerHTML = '<tr><td colspan="4" style="text-align:center; opacity:0.5;">Sin proveedores registrados.</td></tr>';
                return;
            }
            body.innerHTML = lista.map(p => `
                <tr>
                    <td>${p.Documento}</td>
                    <td>${p.RazonSocial}</td>
                    <td>${p.Correo || p.Telefono || '--'}</td>
                    <td>
                        <button class="btn-neo" style="padding:8px 12px; color:var(--hotel-blue);" title="Descargar todos sus comprobantes" onclick="RetencionesModule.descargarTodoProveedor(${p.ProveedorID})"><i class="fas fa-file-archive"></i></button>
                        <button class="btn-neo btn-danger" style="padding:8px 12px;" onclick="RetencionesModule.eliminarProveedor(${p.ProveedorID})"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `).join('');
        } catch (err) {
            console.error('Error buscando proveedores:', err);
        }
    },

    async descargarTodoProveedor(proveedorId) {
        try {
            Swal.fire({ title: 'Empaquetando comprobantes...', text: 'Generando XML y PDF de cada documento.', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const res = await api.get(`/proveedores/${proveedorId}/descargar-todo`);
            Swal.close();
            if (res.data.success) {
                const base = api.defaults.baseURL.replace(/\/api\/?$/, '');
                window.open(`${base}${res.data.zipUrl}`, '_blank');
            }
        } catch (err) {
            Swal.close();
            Swal.fire('Sin comprobantes', err.response?.data?.error || 'No se pudo generar la descarga.', 'info');
        }
    },

    async crearProveedor() {
        const Documento = document.getElementById('pvDocumento').value.trim();
        const RazonSocial = document.getElementById('pvRazonSocial').value.trim();
        if (!Documento || !RazonSocial) return Swal.fire('Faltan datos', 'Documento y Razón Social son obligatorios.', 'warning');

        try {
            await api.post('/proveedores', {
                Documento, RazonSocial,
                Correo: document.getElementById('pvCorreo').value.trim() || null,
                Telefono: document.getElementById('pvTelefono').value.trim() || null,
                Direccion: document.getElementById('pvDireccion').value.trim() || null
            });
            window.Toast.fire({ icon: 'success', title: 'Proveedor registrado' });
            ['pvDocumento','pvRazonSocial','pvCorreo','pvTelefono','pvDireccion'].forEach(id => document.getElementById(id).value = '');
            this.buscarProveedores();
            this.cargarProveedoresCache();
        } catch (err) {
            Swal.fire('Error', err.response?.data?.error || 'No se pudo crear el proveedor.', 'error');
        }
    },

    async eliminarProveedor(id) {
        const confirm = await Swal.fire({ title: '¿Desactivar proveedor?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí, desactivar' });
        if (!confirm.isConfirmed) return;
        try {
            await api.delete(`/proveedores/${id}`);
            this.buscarProveedores();
            this.cargarProveedoresCache();
        } catch (err) {
            Swal.fire('Error', err.response?.data?.error || 'No se pudo desactivar.', 'error');
        }
    },

    // ══════════════════ CÓDIGOS DE RETENCIÓN ══════════════════

    async crearCodigo() {
        const Tipo = document.getElementById('crTipo').value;
        const Codigo = document.getElementById('crCodigo').value.trim();
        const Descripcion = document.getElementById('crDescripcion').value.trim();
        const PorcentajeDefault = parseFloat(document.getElementById('crPorcentaje').value);
        if (!Codigo || !Descripcion || isNaN(PorcentajeDefault)) return Swal.fire('Faltan datos', 'Complete código, descripción y porcentaje.', 'warning');

        try {
            await api.post('/codigosretencion', { Tipo, Codigo, Descripcion, PorcentajeDefault });
            window.Toast.fire({ icon: 'success', title: 'Código agregado' });
            ['crCodigo','crDescripcion','crPorcentaje'].forEach(id => document.getElementById(id).value = '');
            this.cargarCodigos();
        } catch (err) {
            Swal.fire('Error', err.response?.data?.error || 'No se pudo agregar el código.', 'error');
        }
    },

    async eliminarCodigo(id) {
        const confirm = await Swal.fire({ title: '¿Eliminar código?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí, eliminar' });
        if (!confirm.isConfirmed) return;
        try {
            await api.delete(`/codigosretencion/${id}`);
            this.cargarCodigos();
        } catch (err) {
            Swal.fire('Error', err.response?.data?.error || 'No se pudo eliminar.', 'error');
        }
    },

    // ══════════════════ LIQUIDACIÓN DE COMPRA (SRI '03') ══════════════════

    agregarItemLiquidacion() {
        const desc = document.getElementById('lcDetDesc').value.trim();
        const cant = parseFloat(document.getElementById('lcDetCant').value);
        const precio = parseFloat(document.getElementById('lcDetPrecio').value);
        if (!desc) return Swal.fire('Falta la descripción', 'Ingrese qué se compró.', 'warning');
        if (!cant || cant <= 0) return Swal.fire('Cantidad inválida', 'La cantidad debe ser mayor a 0.', 'warning');
        if (!precio || precio <= 0) return Swal.fire('Precio inválido', 'El precio unitario debe ser mayor a 0.', 'warning');

        this.itemsLiquidacion.push({ Descripcion: desc, Cantidad: cant, PrecioUnitario: precio });

        document.getElementById('lcDetDesc').value = '';
        document.getElementById('lcDetCant').value = '1';
        document.getElementById('lcDetPrecio').value = '';
        this.renderItemsLiquidacion();
    },

    quitarItemLiquidacion(index) {
        this.itemsLiquidacion.splice(index, 1);
        this.renderItemsLiquidacion();
    },

    renderItemsLiquidacion() {
        const body = document.getElementById('lcTablaItemsBody');
        if (!this.itemsLiquidacion.length) {
            body.innerHTML = '<tr><td colspan="5" style="text-align:center; opacity:0.5;">Sin ítems agregados</td></tr>';
        } else {
            body.innerHTML = this.itemsLiquidacion.map((it, i) => `
                <tr>
                    <td>${it.Descripcion}</td>
                    <td>${it.Cantidad}</td>
                    <td>$${it.PrecioUnitario.toFixed(2)}</td>
                    <td>$${(it.Cantidad * it.PrecioUnitario).toFixed(2)}</td>
                    <td><button class="btn-neo btn-danger" style="padding:8px 12px;" onclick="RetencionesModule.quitarItemLiquidacion(${i})"><i class="fas fa-trash"></i></button></td>
                </tr>
            `).join('');
        }
        const total = this.itemsLiquidacion.reduce((acc, it) => acc + it.Cantidad * it.PrecioUnitario, 0);
        document.getElementById('lcTotalGeneral').textContent = total.toFixed(2);
    },

    async emitirLiquidacion() {
        const documento = document.getElementById('lcProvDocumento').value.trim();
        const razonSocial = document.getElementById('lcProvRazonSocial').value.trim();
        if (!documento || !razonSocial) return Swal.fire('Faltan datos', 'Documento y Razón Social del proveedor son obligatorios.', 'warning');
        if (!this.itemsLiquidacion.length) return Swal.fire('Sin ítems', 'Agregue al menos un ítem comprado.', 'warning');

        const user = JSON.parse(localStorage.getItem('user'));
        const payload = {
            SedeID: this.getSedeId(),
            UsuarioID: user ? user.UsuarioID : 1,
            Proveedor: {
                Documento: documento,
                TipoIdentificacion: documento.length === 13 ? '04' : '05',
                RazonSocial: razonSocial
            },
            Detalles: this.itemsLiquidacion.map(it => ({ Descripcion: it.Descripcion, Cantidad: it.Cantidad, PrecioUnitario: it.PrecioUnitario })),
            FormaPago: document.getElementById('lcFormaPago').value
        };

        try {
            Swal.fire({ title: 'Emitiendo Liquidación de Compra...', text: 'Firmando XML e interactuando con SRI...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const res = await api.post('/liquidacionescompra/emitir', payload);
            if (res.data.success) {
                await Swal.fire({ title: '¡LIQUIDACIÓN EMITIDA!', text: `SRI: ${res.data.estadoSRI} | Acceso: ${res.data.claveAcceso}`, icon: 'success', confirmButtonColor: 'var(--hotel-blue)' });
                this.itemsLiquidacion = [];
                this.renderItemsLiquidacion();
                ['lcProvSelect','lcProvDocumento','lcProvRazonSocial'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
                await this.cargarHistorialLiquidacion();
                await this.cargarProveedoresCache();
            }
        } catch (err) {
            Swal.fire({ icon: 'error', title: 'No se pudo emitir', text: err.response?.data?.error || 'Error desconocido' });
        }
    },

    async cargarHistorialLiquidacion() {
        try {
            const res = await api.get(`/liquidacionescompra/historial/${this.getSedeId()}`);
            this.historialLiquidacionCache = res.data || [];
            this.renderHistorialLiquidacion();
        } catch (err) {
            console.error('Error cargando historial de liquidaciones de compra:', err);
        }
    },

    renderHistorialLiquidacion() {
        const body = document.getElementById('lcTablaHistorialBody');
        if (!body) return;
        const buscar = (document.getElementById('lcHistorialBuscar')?.value || '').trim().toLowerCase();
        const base = this.historialLiquidacionCache || [];
        const lista = buscar
            ? base.filter(l => (l.ProveedorNombre || '').toLowerCase().includes(buscar) || (l.ProveedorDocumento || '').toLowerCase().includes(buscar) || (l.Secuencial || '').toLowerCase().includes(buscar))
            : base;

        if (!lista.length) {
            body.innerHTML = `<tr><td colspan="5" style="text-align:center; opacity:0.5;">${buscar ? `Sin resultados para "${buscar}".` : 'Sin liquidaciones emitidas.'}</td></tr>`;
            return;
        }
        body.innerHTML = lista.map(l => {
            const badgeClass = l.EstadoSRI === 'AUTORIZADO' ? 'badge-autorizado'
                : l.EstadoSRI === 'FIRMADO' ? 'badge-firmado'
                : l.EstadoSRI === 'RECHAZADO' ? 'badge-rechazado' : 'badge-pendiente';
            return `
                <tr>
                    <td>${l.Secuencial}</td>
                    <td>${l.ProveedorNombre}<br><small style="opacity:0.6;">${l.ProveedorDocumento || ''}</small></td>
                    <td>$${parseFloat(l.Total).toFixed(2)}</td>
                    <td><span class="badge-sri ${badgeClass}">${l.EstadoSRI || 'PENDIENTE'}</span></td>
                    <td>
                        <button class="btn-neo" style="padding:8px 12px;" title="Ver RIDE" onclick="RetencionesModule.verRIDELiquidacion(${l.LiquidacionCompraID})"><i class="fas fa-file-pdf"></i></button>
                        <button class="btn-neo" style="padding:8px 12px;" title="Ver XML" onclick="RetencionesModule.verXMLLiquidacion(${l.LiquidacionCompraID})"><i class="fas fa-code"></i></button>
                        <button class="btn-neo" style="padding:8px 12px;" title="Enviar correo" onclick="RetencionesModule.enviarCorreoLiquidacion(${l.LiquidacionCompraID})"><i class="fas fa-envelope"></i></button>
                    </td>
                </tr>
            `;
        }).join('');
    },

    async verRIDELiquidacion(liquidacionId) {
        try {
            const res = await api.get(`/liquidacionescompra/documento/ride/${liquidacionId}`);
            if (res.data.success) {
                const base = api.defaults.baseURL.replace(/\/api\/?$/, '');
                window.open(`${base}${res.data.pdfUrl}`, '_blank');
            }
        } catch (err) {
            Swal.fire('Error', err.response?.data?.error || 'No se pudo generar el RIDE.', 'error');
        }
    },

    async verXMLLiquidacion(liquidacionId) {
        try {
            const res = await api.get(`/liquidacionescompra/documento/xml/${liquidacionId}`);
            if (res.data.success) {
                Swal.fire({
                    icon: 'info', title: 'XML de la Liquidación de Compra', width: 700,
                    html: `<textarea readonly style="width:100%; height:340px; font-family:Consolas,monospace; font-size:10.5px; background:#f1f3f5; border-radius:8px; padding:10px; border:1px solid #ccc;">${res.data.xml.replace(/</g, '&lt;')}</textarea>`
                });
            }
        } catch (err) {
            Swal.fire('Error', err.response?.data?.error || 'No se pudo obtener el XML.', 'error');
        }
    },

    async enviarCorreoLiquidacion(liquidacionId) {
        const { value: correo } = await Swal.fire({
            title: 'Enviar Liquidación de Compra',
            input: 'email',
            inputPlaceholder: 'correo@ejemplo.com',
            showCancelButton: true,
            confirmButtonText: 'Enviar'
        });
        if (!correo) return;
        try {
            Swal.fire({ title: 'Enviando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            await api.post('/liquidacionescompra/documento/enviar-correo', { liquidacionId, correoDestino: correo });
            await Swal.fire('Enviado', 'El correo fue enviado correctamente.', 'success');
        } catch (err) {
            Swal.fire('Error', err.response?.data?.error || 'No se pudo enviar el correo.', 'error');
        }
    }
};

module.exports = RetencionesModule;
