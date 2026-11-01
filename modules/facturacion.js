const api = require('./api');
const NotasCreditoModule = require('./notascredito');
const NotasDebitoModule = require('./notasdebito');
const RetencionesModule = require('./retenciones');
const { marcarBuscando } = require('./uiLoading');
const pt = require('./printTicket');

// Tarifas SRI (codigoPorcentaje) — mismas que Backend/services/facturaLineas.js
const TARIFAS_IVA = { '4': 'IVA', '0': '0%', '5': '5%', '6': 'No obj.', '7': 'Exento' };
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FacturacionModule = {
    comprobantes: [],
    certificadoActivo: null,
    detallesManuales: [],
    productosManual: [],

    async init() {
        console.log("📡 Módulo de Facturación Electrónica SRI Iniciado...");

        this.renderSedeSelector();
        await this.cargarCertificadoSede();
        await this.cargarHistorial();
        this.cargarProductosManual();
        const selFmt = document.getElementById('facFormatoTicket');
        if (selFmt) selFmt.innerHTML = pt.selectorHTML('fac-formato-ticket');
        
        this.setupEventListeners();
        this.verificarPermisosConfig();
        window.FacturacionModule = this;
        window.NotasCreditoModule = NotasCreditoModule;
        window.NotasDebitoModule = NotasDebitoModule;
        window.RetencionesModule = RetencionesModule;
    },

    verificarPermisosConfig() {
        const user = JSON.parse(localStorage.getItem('user'));
        const isAdmin = user && parseInt(user.RolID || user.rol) === 1;
        
        const btnC = document.getElementById('btnTabConfig');
        const formCert = document.getElementById('formCertificadoSRI');
        const fileInput = document.getElementById('fileP12');
        const passwordInput = document.getElementById('passP12');
        const inputSecuencial = document.getElementById('inSecuencial');
        const btnGuardarSec = document.querySelector("button[onclick*='guardarSecuencial']");

        if (!isAdmin) {
            if (btnC) {
                btnC.style.display = 'none';
            }
            
            if (fileInput) fileInput.disabled = true;
            if (passwordInput) passwordInput.disabled = true;
            if (inputSecuencial) inputSecuencial.disabled = true;
            if (btnGuardarSec) btnGuardarSec.disabled = true;
            
            if (formCert) {
                formCert.onsubmit = (e) => {
                    e.preventDefault();
                    Swal.fire('Acceso Restringido', 'Solo los administradores pueden modificar los parámetros criptográficos del SRI.', 'error');
                };
            }
        }
    },

    renderSedeSelector() {
        App.renderSedeSelector('sedeSelectorFacturacion', async () => {
            await this.cargarCertificadoSede();
            await this.cargarHistorial();
            this.verificarPermisosConfig();
        });
    },

    getSedeId() {
        const selector = document.getElementById('globalSedeSelector');
        if (selector) return selector.value;
        const user = JSON.parse(localStorage.getItem('user'));
        return localStorage.getItem('currentSedeId') || (user ? user.SedeID : 1);
    },

    switchTab(tab) {
        const user = JSON.parse(localStorage.getItem('user'));
        const isAdmin = user && parseInt(user.RolID || user.rol) === 1;
        if (tab === 'config' && !isAdmin) {
            Swal.fire('Acceso Restringido', 'No tiene permisos para ver esta sección.', 'error');
            return;
        }

        const tabH  = document.getElementById('tabHistorial');
        const tabM  = document.getElementById('tabManual');
        const tabNC = document.getElementById('tabNotaCredito');
        const tabND = document.getElementById('tabNotaDebito');
        const tabR  = document.getElementById('tabRetenciones');
        const tabC  = document.getElementById('tabConfig');

        const btnH  = document.getElementById('btnTabHistorial');
        const btnM  = document.getElementById('btnTabManual');
        const btnNC = document.getElementById('btnTabNotaCredito');
        const btnND = document.getElementById('btnTabNotaDebito');
        const btnR  = document.getElementById('btnTabRetenciones');
        const btnC  = document.getElementById('btnTabConfig');

        if (tabH)  tabH.classList.toggle('hidden', tab !== 'historial');
        if (tabM)  tabM.classList.toggle('hidden', tab !== 'manual');
        if (tabNC) tabNC.classList.toggle('hidden', tab !== 'notacredito');
        if (tabND) tabND.classList.toggle('hidden', tab !== 'notadebito');
        if (tabR)  tabR.classList.toggle('hidden', tab !== 'retenciones');
        if (tabC)  tabC.classList.toggle('hidden', tab !== 'config');

        if (btnH)  btnH.classList.toggle('active', tab === 'historial');
        if (btnM)  btnM.classList.toggle('active', tab === 'manual');
        if (btnNC) btnNC.classList.toggle('active', tab === 'notacredito');
        if (btnND) btnND.classList.toggle('active', tab === 'notadebito');
        if (btnR)  btnR.classList.toggle('active', tab === 'retenciones');
        if (btnC)  btnC.classList.toggle('active', tab === 'config');

        if (tab === 'notacredito' && window.NotasCreditoModule) {
            window.NotasCreditoModule.init();
        }
        if (tab === 'notadebito' && window.NotasDebitoModule) {
            window.NotasDebitoModule.init();
        }
        if (tab === 'retenciones' && window.RetencionesModule) {
            window.RetencionesModule.init();
        }
    },

    async cargarCertificadoSede() {
        const sedeId = this.getSedeId();
        const lblSede = document.getElementById('lblCertSede');
        const lblVenc = document.getElementById('lblCertVencimiento');
        const badgeState = document.getElementById('badgeCertEstado');
        const iconStatus = document.getElementById('iconCertStatus');
        const inputSecuencial = document.getElementById('inSecuencial');
        const selectAmbiente = document.getElementById('cfgAmbiente');

        if (!lblSede) return;

        try {
            const res = await api.get(`/facturacion/certificados/${sedeId}`);
            
            if (inputSecuencial && res.data) {
                inputSecuencial.value = res.data.secuencialActual;
            }
            if (selectAmbiente && res.data) {
                selectAmbiente.value = res.data.ambienteActual;
            }

            if (res.data && res.data.certificado) {
                this.certificadoActivo = res.data.certificado;
                lblSede.textContent = "Firma Electrónica Configurada";
                lblSede.style.color = "var(--hotel-blue)";
                
                const fechaFmt = new Date(this.certificadoActivo.FechaVencimiento).toLocaleDateString('es-EC');
                lblVenc.textContent = `Vence el: ${fechaFmt}`;
                
                badgeState.innerHTML = `<span class="badge-sri badge-autorizado"><i class="fas fa-shield-alt"></i> Certificado Listo</span>`;
                iconStatus.innerHTML = `<i class="fas fa-file-signature" style="color: var(--hotel-success); filter: drop-shadow(0 0 8px rgba(39,174,96,0.3));"></i>`;
            } else {
                this.certificadoActivo = null;
                lblSede.textContent = "Sin Firma Electrónica";
                lblSede.style.color = "var(--hotel-danger)";
                lblVenc.textContent = "La sede requiere un archivo .p12 para firmar XMLs";
                badgeState.innerHTML = `<span class="badge-sri badge-rechazado">Inoperativo</span>`;
                iconStatus.innerHTML = `<i class="fas fa-certificate" style="color: #718096;"></i>`;
            }
        } catch (e) {
            console.error("Fallo al recuperar estado criptográfico:", e);
        }
    },

    async guardarSecuencial() {
        const user = JSON.parse(localStorage.getItem('user'));
        if (user && parseInt(user.RolID || user.rol) !== 1) {
            return Swal.fire('Error', 'Acción no permitida para su nivel de acceso', 'error');
        }

        const secuencial = document.getElementById('inSecuencial').value;
        if (!secuencial || secuencial < 1) return Swal.fire('Atención', 'Ingrese un número válido mayor a 0', 'warning');

        try {
            const res = await api.post('/facturacion/secuencial/actualizar', {
                SedeID: this.getSedeId(),
                Secuencial: secuencial
            });

            if (res.data.success) {
                window.Toast.fire({ icon: 'success', title: 'Secuencial Guardado', text: `La próxima factura será la #${secuencial}` });
            }
        } catch (err) {
            Swal.fire('Error', 'No se pudo actualizar el secuencial', 'error');
        }
    },

    // Productos de la sede para la factura manual (solo arma la factura: no descarga inventario).
    async cargarProductosManual() {
        const lista = document.getElementById('manProdLista');
        if (!lista) return;
        try {
            const res = await api.get(`/inventario/sede/${this.getSedeId()}`);
            this.productosManual = (res.data || []).filter(p => p.TipoItem !== 'INSUMO' && p.TipoItem !== 'PREPARACION');
            lista.innerHTML = this.productosManual.map(p =>
                `<option value="${esc(p.Nombre)}">${esc([p.CodigoBarras, `$${Number(p.PrecioVenta || 0).toFixed(2)}`, TARIFAS_IVA[p.TarifaIVA || '4']].filter(Boolean).join(' · '))}</option>`).join('');
        } catch (e) {
            this.productosManual = [];
        }
    },

    elegirProductoManual() {
        const txt = (document.getElementById('manProdBuscar').value || '').trim().toLowerCase();
        const p = txt && this.productosManual.find(x => x.Nombre.toLowerCase() === txt || (x.CodigoBarras && x.CodigoBarras.toLowerCase() === txt));
        this.productoElegido = p || null;
        if (!p) return;
        document.getElementById('manDetDesc').value = p.Nombre;
        document.getElementById('manDetPrecio').value = Number(p.PrecioVenta || 0).toFixed(2);
        document.getElementById('manDetTarifa').value = p.TarifaIVA || '4';
        document.getElementById('manDetCant').focus();
    },

    agregarDetalleManual() {
        const desc = document.getElementById('manDetDesc').value.trim();
        const cant = parseFloat(document.getElementById('manDetCant').value);
        const precio = parseFloat(document.getElementById('manDetPrecio').value);
        const tarifa = document.getElementById('manDetTarifa')?.value || '4';

        if (!desc || isNaN(cant) || cant <= 0 || isNaN(precio) || precio < 0) {
            return Swal.fire('Error', 'Ingrese una descripción, cantidad válida y precio unitario.', 'warning');
        }

        const p = this.productoElegido && this.productoElegido.Nombre === desc ? this.productoElegido : null;
        this.detallesManuales.push({
            Codigo: p ? String(p.CodigoBarras || p.ProductoID) : 'MAN001',
            ProductoID: p ? p.ProductoID : null,
            Descripcion: desc,
            Cantidad: cant,
            PrecioUnitario: precio,
            Tarifa: tarifa
        });

        document.getElementById('manProdBuscar').value = '';
        this.productoElegido = null;
        document.getElementById('manDetDesc').value = '';
        document.getElementById('manDetCant').value = '1';
        document.getElementById('manDetPrecio').value = '';
        document.getElementById('manDetTarifa').value = '4';
        document.getElementById('manProdBuscar').focus();

        this.renderDetallesManual();
    },

    servicioPctManual() {
        if (!document.getElementById('manServicioChk')?.checked) return 0;
        const v = parseFloat(document.getElementById('manServicioPct').value);
        return isFinite(v) ? Math.min(10, Math.max(0, v)) : 0;
    },

    removerDetalleManual(index) {
        this.detallesManuales.splice(index, 1);
        this.renderDetallesManual();
    },

    renderDetallesManual() {
        const tbody = document.getElementById('tablaDetallesManual');
        if (!tbody) return;

        const poner = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v.toFixed(2); };
        const mostrar = (id, si) => { const el = document.getElementById(id); if (el) el.style.display = si ? '' : 'none'; };

        // Vista previa: el servidor recalcula todo con el IVA real de la sede al emitir.
        const PCT_IVA = parseFloat(localStorage.getItem('sede_iva_pct') || '15');
        const pctDe = t => t === '4' ? PCT_IVA : (t === '5' ? 5 : 0);
        const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
        const base = { '4': 0, '0': 0, '5': 0, otros: 0 };
        let iva = 0;
        let html = '';

        this.detallesManuales.forEach((item, idx) => {
            const lineaConIva = item.Cantidad * item.PrecioUnitario;
            const t = item.Tarifa || '4';
            const pct = pctDe(t);
            const b = r2(lineaConIva / (1 + pct / 100));
            iva += r2(lineaConIva - b);
            base[t === '6' || t === '7' ? 'otros' : t] += b;
            html += `
                <tr>
                    <td>${esc(item.Descripcion)}</td>
                    <td>${item.Cantidad}</td>
                    <td>$${item.PrecioUnitario.toFixed(2)}</td>
                    <td><small style="font-weight:800; color:${t === '4' ? 'var(--hotel-blue)' : '#c05621'};">${TARIFAS_IVA[t]}</small></td>
                    <td>$${lineaConIva.toFixed(2)}</td>
                    <td>
                        <button class="btn-neo btn-danger" style="padding: 5px 10px;" onclick="FacturacionModule.removerDetalleManual(${idx})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html || '<tr><td colspan="6" style="text-align: center; opacity: 0.5;">No hay ítems agregados</td></tr>';

        const subtotal = r2(base['4'] + base['0'] + base['5'] + base.otros);
        const servicio = r2(subtotal * this.servicioPctManual() / 100);
        iva = r2(iva);
        poner('manSubIva', base['4']);
        poner('manSubCero', base['0']);
        poner('manSubCinco', base['5']);
        poner('manSubNoObj', base.otros);
        poner('manTotalIva', iva);
        poner('manServicio', servicio);
        mostrar('manFilaCinco', base['5'] > 0);
        mostrar('manFilaNoObj', base.otros > 0);
        mostrar('manFilaServicio', servicio > 0);
        poner('manTotalGeneral', r2(subtotal + iva + servicio));
    },

    // ==========================================
    // BÚSQUEDA INTELIGENTE PARA FACTURA MANUAL
    // ==========================================
    async buscarClienteManual() {
        const inputDoc = document.getElementById('manDocCliente');
        const doc = inputDoc.value.trim();
        if (!doc) return;

        marcarBuscando(inputDoc, true);
        try {
            const res = await api.get(`/recepcion/cliente/${doc}`);

            if (res.data.success) {
                const c = res.data.cliente;
                document.getElementById('manNomCliente').value = c.NombreFull || '';
                document.getElementById('manCorreoCliente').value = c.Correo || '';
                document.getElementById('manTelCliente').value = c.Telefono || '';
                document.getElementById('manDirCliente').value = c.Direccion || '';

                if (res.data.source === 'padron') {
                    window.Toast.fire({ icon: 'success', title: 'DATOS OBTENIDOS DEL SRI', text: 'Se auto-rellenó desde el Padrón Nacional.' });
                } else {
                    window.Toast.fire({ icon: 'success', title: 'Cliente encontrado en Base Local' });
                }
            } else {
                document.getElementById('manNomCliente').value = '';
                document.getElementById('manCorreoCliente').value = '';
                document.getElementById('manTelCliente').value = '';
                document.getElementById('manDirCliente').value = '';
                window.Toast.fire({ icon: 'info', title: 'NUEVO CLIENTE', text: 'No existe en registros. Complete los datos manualmente.' });
            }
        } catch (e) {
            console.error("Error buscando cliente manual:", e);
            window.Toast.fire({ icon: 'error', title: 'Error en conexión de búsqueda' });
        } finally {
            marcarBuscando(inputDoc, false);
        }
    },

    async emitirFacturaManualUI() {
        const doc = document.getElementById('manDocCliente').value.trim();
        const nom = document.getElementById('manNomCliente').value.trim();
        const correo = document.getElementById('manCorreoCliente').value.trim();
        const telefono = document.getElementById('manTelCliente').value.trim();
        const direccion = document.getElementById('manDirCliente').value.trim();
        const formaPago = document.getElementById('manFormaPago').value;

        if (!doc || !nom) return Swal.fire('Error', 'Ingrese los datos del cliente (Cédula/RUC y Nombre)', 'warning');
        if (this.detallesManuales.length === 0) return Swal.fire('Error', 'Debe agregar al menos un ítem a la factura', 'warning');
        if (!this.certificadoActivo) return Swal.fire('Error', 'No hay firma electrónica configurada', 'error');

        const user = JSON.parse(localStorage.getItem('user'));

        const payload = {
            UsuarioID: user ? user.UsuarioID : 1,
            SedeID: this.getSedeId(),
            FormaPago: formaPago,
            Cliente: { Documento: doc, NombreFull: nom, Correo: correo, Telefono: telefono, Direccion: direccion },
            Detalles: this.detallesManuales,
            ServicioPct: this.servicioPctManual()
        };

        try {
            Swal.fire({ title: 'Generando Factura...', text: 'Firmando XML e interactuando con SRI...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            
            const res = await api.post('/facturacion/documento/emitir-manual', payload);

            if (res.data.success) {
                const imp = await Swal.fire({ title: '¡FACTURA EMITIDA!', icon: 'success',
                    html: `SRI: <b>${esc(res.data.estadoSRI)}</b> · Total <b>$${Number(res.data.total || 0).toFixed(2)}</b><br><small style="word-break:break-all;">${esc(res.data.claveAcceso)}</small>
                           <div style="margin-top:14px;">¿Imprimir? ${pt.selectorHTML('fac-formato-emitida')}</div>`,
                    showCancelButton: true, confirmButtonText: '<i class="fas fa-print"></i> Imprimir', cancelButtonText: 'Listo',
                    confirmButtonColor: 'var(--hotel-blue)' });
                if (imp.isConfirmed && res.data.facturaId) {
                    if (pt.getFormato() === 'a4') await this.imprimirFactura(res.data.facturaId, true);
                    else await this.imprimirTicket(res.data.facturaId);
                }

                document.getElementById('manDocCliente').value = '';
                document.getElementById('manNomCliente').value = '';
                document.getElementById('manCorreoCliente').value = '';
                document.getElementById('manTelCliente').value = '';
                document.getElementById('manDirCliente').value = '';
                this.detallesManuales = [];
                const chk = document.getElementById('manServicioChk');
                if (chk) chk.checked = false;
                this.renderDetallesManual();
                
                await this.cargarHistorial();
                this.switchTab('historial');
            }
        } catch (err) {
            const msg = err.response?.data?.error || 'Error al generar la factura manual';
            Swal.fire('Error SRI', msg, 'error');
        }
    },

    // Reintenta la transmisión al SRI de todo lo que quedó en FIRMADO (emitido
    // sin internet) — Factura, NC, ND, Retención y Liquidación de Compra de esta sede.
    async sincronizarEmisiones() {
        const sedeId = this.getSedeId();
        try {
            Swal.fire({ title: 'Sincronizando con el SRI...', text: 'Reintentando comprobantes pendientes de transmisión.', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const res = await api.post(`/sincronizacion/${sedeId}`);
            Swal.close();

            const { revisados, actualizados, siguenPendientes } = res.data;
            if (!revisados) {
                window.Toast.fire({ icon: 'info', title: 'Sin pendientes', text: 'No hay comprobantes esperando sincronización.' });
            } else if (actualizados.length) {
                const detalle = actualizados.map(a => `${a.tipo} ${a.secuencial}: <b>${a.estadoNuevo}</b>`).join('<br>');
                await Swal.fire({ icon: 'success', title: `${actualizados.length} comprobante(s) sincronizados`, html: detalle });
            } else {
                Swal.fire('Sigue sin conexión', `Se revisaron ${revisados} comprobante(s) pendientes, pero ninguno pudo transmitirse (¿sigue sin internet?).`, 'warning');
            }
            await this.cargarHistorial();
        } catch (err) {
            Swal.close();
            Swal.fire('Error', err.response?.data?.error || 'No se pudo sincronizar.', 'error');
        }
    },

    async cargarHistorial() {
        const sedeId = this.getSedeId();
        const body = document.getElementById('tablaFacturasBody');
        if (body) body.innerHTML = '<tr><td colspan="6" style="text-align:center; opacity:0.5;">Sincronizando bitácora...</td></tr>';

        try {
            const res = await api.get(`/facturacion/historial/${sedeId}`);
            this.comprobantes = res.data || [];
            this.renderHistorial();
        } catch (err) {
            if (body) body.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--hotel-danger);">Error de conexión con el servidor.</td></tr>';
        }
    },

    renderHistorial() {
        const body = document.getElementById('tablaFacturasBody');
        if (!body) return;

        if (this.comprobantes.length === 0) {
            body.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:40px; opacity:0.5; font-weight:800;">
                <i class="fas fa-file-invoice" style="font-size:2rem; margin-bottom:10px; display:block;"></i>
                NO SE HAN EMITIDO COMPROBANTES ELECTRÓNICOS EN ESTA SUCURSAL
            </td></tr>`;
            return;
        }

        const buscar = (document.getElementById('histFacturaBuscar')?.value || '').trim().toLowerCase();
        const lista = buscar
            ? this.comprobantes.filter(f =>
                (f.ClienteNombre || '').toLowerCase().includes(buscar) ||
                (f.ClienteDocumento || '').toLowerCase().includes(buscar) ||
                (f.Secuencial || '').toLowerCase().includes(buscar))
            : this.comprobantes;

        if (!lista.length) {
            body.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; opacity:0.5;">Sin resultados para "${buscar}".</td></tr>`;
            return;
        }

        body.innerHTML = lista.map(f => {
            let badgeClass = 'badge-pendiente';
            if (f.EstadoSRI === 'AUTORIZADO') badgeClass = 'badge-autorizado';
            if (f.EstadoSRI === 'FIRMADO') badgeClass = 'badge-firmado';
            if (f.EstadoSRI === 'RECHAZADO') badgeClass = 'badge-rechazado';

            const fechaFmt = f.FechaEmision.replace('T', ' ');
            const tipoAmbiente = f.Ambiente === 2 ? 'PRODUCCIÓN' : 'PRUEBAS';

            return `
                <tr>
                    <td style="font-family: monospace; font-size:1rem; color: var(--hotel-blue); padding-left:20px;">${f.Secuencial}</td>
                    <td>${f.ClienteNombre || '--'}<br><small style="opacity:0.6;">${f.ClienteDocumento || ''}</small></td>
                    <td>${fechaFmt}</td>
                    <td style="font-family: monospace; font-size:0.75rem; color:#718096;">${f.ClaveAcceso}</td>
                    <td><span class="badge-sri ${badgeClass}">${f.EstadoSRI}</span><br><small style="font-size:0.6rem; color:#bebebe;">${tipoAmbiente}</small></td>
                    <td>
                        <div style="display:flex; gap:8px; justify-content: center;">
                            <button class="btn-neo" style="padding:8px 12px; color:#2c3e50;" onclick="FacturacionModule.imprimirFactura('${f.FacturaID}')" title="Imprimir PDF (RIDE)">
                                <i class="fas fa-print"></i>
                            </button>
                            <button class="btn-neo" style="padding:8px 12px; color:#2f855a;" onclick="FacturacionModule.imprimirTicket('${f.FacturaID}')" title="Ticket en impresora térmica (58/80 mm)">
                                <i class="fas fa-receipt"></i>
                            </button>
                            <button class="btn-neo" style="padding:8px 12px; color:#3498db;" onclick="FacturacionModule.enviarCorreo('${f.FacturaID}')" title="Enviar por Correo">
                                <i class="fas fa-envelope"></i>
                            </button>
                            <button class="btn-neo" style="padding:8px 12px; color:var(--hotel-gold);" onclick="FacturacionModule.verXML('${f.FacturaID}')" title="Ver XML Crudo">
                                <i class="fas fa-code"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    },

    async verXML(id) {
        const factura = this.comprobantes.find(f => f.FacturaID == id);
        if (!factura) return;
        
        try {
            Swal.fire({ title: 'Cargando XML...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            
            const res = await api.get(`/facturacion/documento/xml/${id}`);
            
            if (res.data.success) {
                Swal.fire({
                    title: `XML: ${factura.Secuencial}`,
                    html: `<textarea readonly style="width:100%; height:300px; font-family:monospace; font-size:12px; background:#2c3e50; color:#ecf0f1; padding:10px; border-radius:10px;">${res.data.xml.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>`,
                    width: '800px',
                    confirmButtonColor: 'var(--hotel-blue)',
                    confirmButtonText: 'CERRAR'
                });
            }
        } catch(e) {
            Swal.fire('Error', 'No se pudo leer el archivo XML', 'error');
        }
    },

    async imprimirFactura(id, recienEmitida) {
        const factura = this.comprobantes.find(f => f.FacturaID == id);
        if (!factura && !recienEmitida) return;

        Swal.fire({
            title: 'Generando RIDE...',
            text: `Construyendo PDF SRI${factura ? ` para la factura ${factura.Secuencial}` : ''}...`,
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });
        
        try {
            const res = await api.get(`/facturacion/documento/ride/${id}`);
            if (res.data.success) {
                Swal.close();
                const baseUrl = api.defaults.baseURL.replace('/api', '');
                window.open(`${baseUrl}${res.data.pdfUrl}`, '_blank');
            }
        } catch (err) {
            Swal.fire('Error', 'No se pudo generar el documento PDF en el servidor', 'error');
        }
    },

    // Ticket de la factura para impresora térmica (58/80 mm) o A4, con los datos del XML enviado al SRI.
    async imprimirTicket(id) {
        let d;
        try {
            d = (await api.get(`/facturacion/documento/ticket/${id}`)).data;
        } catch (e) {
            return Swal.fire('Error', e.response?.data?.error || 'No se pudo leer la factura', 'error');
        }
        const $ = n => `$${Number(n || 0).toFixed(2)}`;
        const fila = (l, v, cls = '') => `<div class="t-row ${cls}"><span>${l}</span><span>${v}</span></div>`;
        const s = d.subtotales || {};
        const pctGrav = s.tarifaGravado != null ? `${Math.round(s.tarifaGravado)}%` : 'IVA';
        const lineas = (d.detalles || []).map(x => `
            <div>${esc(x.descripcion)}${x.tarifa && x.tarifa !== '4' && x.tarifa !== '2' ? ` <span class="t-sm">(${esc(TARIFAS_IVA[x.tarifa] || x.tarifa)})</span>` : ''}</div>
            ${fila(`<span class="t-sm">${x.cantidad} x ${$(x.precioUnitario)}</span>`, $(x.total))}`).join('');
        const html = `
            <div class="t-center">
                <div class="t-title">${esc(d.nombreComercial || d.razonSocial)}</div>
                ${d.nombreComercial && d.nombreComercial !== d.razonSocial ? `<div class="t-sm">${esc(d.razonSocial)}</div>` : ''}
                <div class="t-sm">RUC ${esc(d.ruc)}</div>
                <div class="t-sm">${esc(d.dirMatriz)}</div>
                ${d.telefonoSede ? `<div class="t-sm">Tel. ${esc(d.telefonoSede)}</div>` : ''}
                <div class="t-sm">Obligado a llevar contabilidad: ${esc(d.obligado)}</div>
                ${d.rimpe ? `<div class="t-sm">${esc(d.rimpe)}</div>` : ''}
            </div>
            <hr class="t-hr">
            <div class="t-center t-b">FACTURA ${esc(d.numero)}</div>
            ${fila('Fecha:', esc(d.fechaHora || d.fechaEmision))}
            ${fila('Ambiente:', esc(d.ambiente))}
            <div class="t-sm">Clave de acceso / autorización:</div>
            <div class="t-sm" style="word-break:break-all;">${esc(d.autorizacion || d.claveAcceso)}</div>
            ${d.estadoSRI !== 'AUTORIZADO' ? `<div class="t-sm t-b">Estado SRI: ${esc(d.estadoSRI)} (pendiente de autorización)</div>` : ''}
            <hr class="t-hr">
            <div><span class="t-b">Cliente:</span> ${esc(d.cliente.nombre)}</div>
            <div class="t-sm">CI/RUC: ${esc(d.cliente.identificacion)}</div>
            ${d.cliente.direccion ? `<div class="t-sm">${esc(d.cliente.direccion)}</div>` : ''}
            <hr class="t-hr">
            ${lineas}
            <hr class="t-hr">
            ${fila(`Subtotal ${pctGrav}`, $(s.gravado))}
            ${s.cero ? fila('Subtotal 0%', $(s.cero)) : ''}
            ${s.cinco ? fila('Subtotal 5%', $(s.cinco)) : ''}
            ${s.noObjeto ? fila('No objeto de IVA', $(s.noObjeto)) : ''}
            ${s.exento ? fila('Exento de IVA', $(s.exento)) : ''}
            ${fila('Subtotal sin impuestos', $(d.subtotal))}
            ${d.descuento ? fila('Descuento', $(d.descuento)) : ''}
            ${fila(`IVA ${pctGrav}`, $(d.iva))}
            ${d.servicio ? fila('Servicio', $(d.servicio)) : ''}
            <hr class="t-hr">
            ${fila('TOTAL', $(d.total), 't-b')}
            <div class="t-sm">Forma de pago: ${esc(d.formaPago)}</div>
            <hr class="t-hr">
            <div class="t-center t-sm">Documento electrónico. Consúltelo en srienlinea.sri.gob.ec con la clave de acceso.</div>
            <div class="t-center t-sm">¡Gracias por su visita!</div>`;
        pt.imprimir(html, { titulo: `Factura ${d.numero}` });
    },

    enviarCorreo(id) {
        const factura = this.comprobantes.find(f => f.FacturaID == id);
        if (!factura) return;

        Swal.fire({
            title: 'Enviar Factura por Correo',
            input: 'email',
            inputLabel: 'Correo Electrónico del Cliente',
            inputPlaceholder: 'cliente@correo.com',
            showCancelButton: true,
            confirmButtonColor: '#3498db',
            cancelButtonColor: 'var(--hotel-danger)',
            confirmButtonText: '<i class="fas fa-paper-plane"></i> Enviar Correo',
            showLoaderOnConfirm: true,
            preConfirm: async (email) => {
                if (!email) {
                    Swal.showValidationMessage('Ingrese un correo electrónico válido');
                    return false;
                }
                try {
                    const res = await api.post('/facturacion/documento/enviar-correo', {
                        facturaId: factura.FacturaID,
                        emailDestino: email
                    });
                    if (!res.data.success) {
                        Swal.showValidationMessage(`Error del servidor: ${res.data.error}`);
                        return false;
                    }
                    return email;
                } catch (err) {
                    const msg = err.response?.data?.error || 'No se pudo conectar con el servidor de correo';
                    Swal.showValidationMessage(msg);
                    return false;
                }
            }
        }).then((result) => {
            if (result.isConfirmed && result.value) {
                window.Toast.fire({
                    icon: 'success',
                    title: 'Correo enviado',
                    text: `Factura ${factura.Secuencial} enviada a ${result.value}`
                });
            }
        });
    },

    setupEventListeners() {
        const inDocManual = document.getElementById('manDocCliente');
        if (inDocManual) {
            inDocManual.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.buscarClienteManual();
                }
            });
        }

        const selectAmbiente = document.getElementById('cfgAmbiente');
        if (selectAmbiente) {
            selectAmbiente.addEventListener('change', async (e) => {
                const user = JSON.parse(localStorage.getItem('user'));
                if (user && parseInt(user.RolID || user.rol) !== 1) {
                    Swal.fire('Denegado', 'No tiene permisos para alterar el ambiente del SRI', 'error');
                    await this.cargarCertificadoSede();
                    return;
                }
                
                try {
                    const nuevoAmbiente = e.target.value;
                    const res = await api.post('/facturacion/ambiente/actualizar', {
                        SedeID: this.getSedeId(),
                        Ambiente: nuevoAmbiente
                    });

                    if (res.data.success) {
                        const nombreAmb = nuevoAmbiente === '2' ? 'PRODUCCIÓN' : 'PRUEBAS';
                        if(window.Toast) window.Toast.fire({ icon: 'info', title: `Ambiente fijado a ${nombreAmb} en la Base de Datos` });
                    }
                } catch (err) {
                    Swal.fire('Error', 'No se pudo actualizar el ambiente en el servidor', 'error');
                    await this.cargarCertificadoSede(); // Revierte el select al estado de la base de datos
                }
            });
        }

        const formCert = document.getElementById('formCertificadoSRI');
        if (formCert) {
            formCert.onsubmit = async (e) => {
                e.preventDefault();
                
                const user = JSON.parse(localStorage.getItem('user'));
                if (user && parseInt(user.RolID || user.rol) !== 1) {
                    return Swal.fire('Fallo de Privilegios', 'Su cuenta no cuenta con autorizaciones de administrador para subir firmas.', 'error');
                }

                const fileInput = document.getElementById('fileP12');
                const passwordInput = document.getElementById('passP12');
                const sedeId = this.getSedeId();

                if (!fileInput.files[0]) return;

                const formData = new FormData();
                formData.append('SedeID', sedeId);
                formData.append('PasswordP12', passwordInput.value);
                formData.append('p12', fileInput.files[0]);

                try {
                    Swal.fire({ title: 'Procesando firma...', text: 'Cargando y validando contenedor criptográfico.', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                    
                    const res = await api.post('/facturacion/certificado/subir', formData, {
                        headers: { 'Content-Type': 'multipart/form-data' }
                    });

                    if (res.data.success) {
                        await Swal.fire({ title: 'SINCRO EXITOSA', text: 'Certificado digital enlazado correctamente a la Sede.', icon: 'success', confirmButtonColor: 'var(--hotel-blue)' });
                        formCert.reset();
                        await this.cargarCertificadoSede();
                        this.switchTab('historial');
                    }
                } catch (err) {
                    const msg = err.response?.data?.error || "No se pudo validar el archivo .p12";
                    Swal.fire({ icon: 'error', title: 'FALLO CRIPTOGRÁFICO', text: msg, confirmButtonColor: 'var(--hotel-blue)' });
                }
            };
        }
    }
};

module.exports = FacturacionModule;