const api = require('./api');

const NotasCreditoModule = {
    facturaSeleccionada: null,
    items: [],
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
        const buscar = document.getElementById('ncBuscarFactura').value.trim();
        const cont = document.getElementById('ncResultadosFacturas');
        cont.innerHTML = '<p style="text-align:center; opacity:0.6; font-size:0.8rem;">Buscando...</p>';
        try {
            const res = await api.get(`/notascredito/facturas/${this.getSedeId()}`, { params: { buscar } });
            const facturas = res.data.facturas || [];
            if (!facturas.length) {
                cont.innerHTML = '<p style="text-align:center; opacity:0.6; font-size:0.8rem;">Sin resultados.</p>';
                return;
            }
            cont.innerHTML = facturas.map(f => `
                <div style="padding:10px 12px; background:#f1f3f5; border-radius:12px; margin-bottom:8px; cursor:pointer;"
                     onclick="NotasCreditoModule.seleccionarFactura(${f.FacturaID})">
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
            const res = await api.get(`/notascredito/factura/${facturaId}/detalle`);
            Swal.close();

            const { factura, cliente, detalles, totales } = res.data;
            this.facturaSeleccionada = { ...factura, cliente };
            this.items = detalles.map(d => ({ ...d, incluir: true }));

            document.getElementById('ncPanelSeleccion').style.display = '';
            document.getElementById('ncClienteNombre').textContent = cliente.Nombre;
            document.getElementById('ncSecuencialFactura').textContent = factura.Secuencial;
            document.getElementById('ncTotalFactura').textContent = `$${totales.total.toFixed(2)}`;
            document.getElementById('ncMotivo').value = '';

            document.getElementById('ncSinFactura').classList.add('hidden');
            document.getElementById('ncTablaItems').classList.remove('hidden');
            document.getElementById('ncTotalesBox').classList.remove('hidden');
            document.getElementById('ncBtnEmitir').classList.remove('hidden');

            this.renderItems();
        } catch (err) {
            Swal.fire('Error', err.response?.data?.error || 'No se pudo cargar la factura.', 'error');
        }
    },

    renderItems() {
        const body = document.getElementById('ncTablaItemsBody');
        body.innerHTML = this.items.map((it, i) => `
            <tr>
                <td>${it.Descripcion}</td>
                <td><input type="number" class="input-neo" style="margin:0; padding:8px;" value="${it.Cantidad}" min="0" step="1"
                     onchange="NotasCreditoModule.actualizarItem(${i}, 'Cantidad', this.value)"></td>
                <td><input type="number" class="input-neo" style="margin:0; padding:8px;" value="${it.PrecioUnitario}" min="0" step="0.01"
                     onchange="NotasCreditoModule.actualizarItem(${i}, 'PrecioUnitario', this.value)"></td>
                <td>$${(it.Cantidad * it.PrecioUnitario).toFixed(2)}</td>
                <td><button type="button" class="btn-neo btn-danger" style="padding:8px 12px;" onclick="NotasCreditoModule.quitarItem(${i})"><i class="fas fa-trash"></i></button></td>
            </tr>
        `).join('');
        this.recalcularTotales();
    },

    actualizarItem(index, campo, valor) {
        this.items[index][campo] = parseFloat(valor) || 0;
        this.renderItems();
    },

    quitarItem(index) {
        this.items.splice(index, 1);
        this.renderItems();
    },

    recalcularTotales() {
        // Los items vienen con precio CON IVA incluido (igual que en Factura Manual);
        // el desglose real de IVA lo hace el backend con desgravarIva al emitir.
        // Acá solo mostramos un estimado con IVA general 15% para referencia visual.
        const tarifaEstim = 15;
        let subtotal = 0, iva = 0;
        this.items.forEach(it => {
            const totalItem = (it.Cantidad || 0) * (it.PrecioUnitario || 0);
            const base = totalItem / (1 + tarifaEstim / 100);
            subtotal += base;
            iva += totalItem - base;
        });
        document.getElementById('ncSubtotal').textContent = subtotal.toFixed(2);
        document.getElementById('ncIva').textContent = iva.toFixed(2);
        document.getElementById('ncTotalGeneral').textContent = (subtotal + iva).toFixed(2);
    },

    async emitir() {
        if (!this.facturaSeleccionada) return;
        const motivo = document.getElementById('ncMotivo').value.trim();
        if (!motivo) return Swal.fire('Falta el motivo', 'Debe indicar el motivo de la Nota de Crédito.', 'warning');
        if (!this.items.length) return Swal.fire('Sin ítems', 'Debe incluir al menos un ítem a acreditar.', 'warning');

        const user = JSON.parse(localStorage.getItem('user'));
        const payload = {
            FacturaID: this.facturaSeleccionada.FacturaID,
            UsuarioID: user ? user.UsuarioID : 1,
            SedeID: this.getSedeId(),
            Motivo: motivo,
            Detalles: this.items.map(it => ({
                Codigo: it.Codigo, Descripcion: it.Descripcion,
                Cantidad: it.Cantidad, PrecioUnitario: it.PrecioUnitario
            }))
        };

        try {
            Swal.fire({ title: 'Generando Nota de Crédito...', text: 'Firmando XML e interactuando con SRI...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const res = await api.post('/notascredito/emitir', payload);
            if (res.data.success) {
                await Swal.fire({ title: '¡NOTA DE CRÉDITO EMITIDA!', text: `SRI: ${res.data.estadoSRI} | Acceso: ${res.data.claveAcceso}`, icon: 'success', confirmButtonColor: 'var(--hotel-blue)' });
                this.resetFormulario();
                await this.cargarHistorial();
            }
        } catch (err) {
            Swal.fire({ icon: 'error', title: 'No se pudo emitir', text: err.response?.data?.error || 'Error desconocido' });
        }
    },

    resetFormulario() {
        this.facturaSeleccionada = null;
        this.items = [];
        document.getElementById('ncPanelSeleccion').style.display = 'none';
        document.getElementById('ncSinFactura').classList.remove('hidden');
        document.getElementById('ncTablaItems').classList.add('hidden');
        document.getElementById('ncTotalesBox').classList.add('hidden');
        document.getElementById('ncBtnEmitir').classList.add('hidden');
        document.getElementById('ncResultadosFacturas').innerHTML = '';
        document.getElementById('ncBuscarFactura').value = '';
    },

    async cargarHistorial() {
        try {
            const res = await api.get(`/notascredito/historial/${this.getSedeId()}`);
            this.historialCache = res.data || [];
            this.renderHistorial();
        } catch (err) {
            console.error('Error cargando historial de NC:', err);
        }
    },

    renderHistorial() {
        const body = document.getElementById('ncTablaHistorialBody');
        if (!body) return;
        const buscar = (document.getElementById('ncHistorialBuscar')?.value || '').trim().toLowerCase();
        const base = this.historialCache || [];
        const lista = buscar
            ? base.filter(nc => (nc.ClienteNombre || '').toLowerCase().includes(buscar) || (nc.ClienteDocumento || '').toLowerCase().includes(buscar) || (nc.Secuencial || '').toLowerCase().includes(buscar))
            : base;

        if (!lista.length) {
            body.innerHTML = `<tr><td colspan="6" style="text-align:center; opacity:0.5;">${buscar ? `Sin resultados para "${buscar}".` : 'Sin Notas de Crédito emitidas.'}</td></tr>`;
            return;
        }
        body.innerHTML = lista.map(nc => {
                const badgeClass = nc.EstadoSRI === 'AUTORIZADO' ? 'badge-autorizado'
                    : nc.EstadoSRI === 'FIRMADO' ? 'badge-firmado'
                    : nc.EstadoSRI === 'RECHAZADO' ? 'badge-rechazado' : 'badge-pendiente';
                return `
                    <tr>
                        <td>${nc.Secuencial}</td>
                        <td>${nc.ClienteNombre}</td>
                        <td>${nc.SecuencialFacturaOriginal}</td>
                        <td>$${parseFloat(nc.Total).toFixed(2)}</td>
                        <td><span class="badge-sri ${badgeClass}">${nc.EstadoSRI || 'PENDIENTE'}</span></td>
                        <td>
                            <button class="btn-neo" style="padding:8px 12px;" title="Ver RIDE" onclick="NotasCreditoModule.verRIDE(${nc.NotaCreditoID})"><i class="fas fa-file-pdf"></i></button>
                            <button class="btn-neo" style="padding:8px 12px;" title="Enviar correo" onclick="NotasCreditoModule.enviarCorreo(${nc.NotaCreditoID})"><i class="fas fa-envelope"></i></button>
                        </td>
                    </tr>
                `;
            }).join('');
    },

    async verRIDE(notaCreditoId) {
        try {
            const res = await api.get(`/notascredito/documento/ride/${notaCreditoId}`);
            if (res.data.success) {
                const base = api.defaults.baseURL.replace(/\/api\/?$/, '');
                window.open(`${base}${res.data.pdfUrl}`, '_blank');
            }
        } catch (err) {
            Swal.fire('Error', err.response?.data?.error || 'No se pudo generar el RIDE.', 'error');
        }
    },

    async enviarCorreo(notaCreditoId) {
        const { value: correo } = await Swal.fire({
            title: 'Enviar Nota de Crédito',
            input: 'email',
            inputPlaceholder: 'correo@ejemplo.com',
            showCancelButton: true,
            confirmButtonText: 'Enviar'
        });
        if (!correo) return;
        try {
            Swal.fire({ title: 'Enviando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            await api.post('/notascredito/documento/enviar-correo', { notaCreditoId, correoDestino: correo });
            await Swal.fire('Enviado', 'El correo fue enviado correctamente.', 'success');
        } catch (err) {
            Swal.fire('Error', err.response?.data?.error || 'No se pudo enviar el correo.', 'error');
        }
    }
};

module.exports = NotasCreditoModule;
