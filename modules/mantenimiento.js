const api = require('./api');
const Unidades = require('./unidades');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + (parseFloat(n) || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MantenimientoModule = {
    _sedeId: null,
    _isAdmin: false,
    _editId: null,
    _habitaciones: [],
    _productos: [],

    async init() {
        window.MantenimientoModule = this;
        const user = JSON.parse(localStorage.getItem('user'));
        this._isAdmin = require('./permisos').puede('mantenimiento', 3);   // permiso "Total" en Mantenimiento
        this._sedeId  = localStorage.getItem('currentSedeId') || user?.SedeID || 1;
        await Promise.all([this.cargarOrdenes(), this.cargarStats(), this.cargarCatalogos()]);
    },

    // Habitaciones (para enlazar la orden y sumar a su costo) y materiales del inventario.
    async cargarCatalogos() {
        try {
            const [h, p] = await Promise.all([
                api.get(`/habitaciones/sede/${this._sedeId}`),
                this._isAdmin ? api.get(`/inventario/sede/${this._sedeId}`) : Promise.resolve({ data: [] }),
            ]);
            this._habitaciones = (h.data || []).sort((a, b) => String(a.NroHabitacion).localeCompare(String(b.NroHabitacion), 'es', { numeric: true }));
            this._productos = (p.data || []).filter(x => x.TipoItem !== 'SERVICIO' && x.EsPlatoReceta != 1);
        } catch (_) { this._habitaciones = []; this._productos = []; }
        const opts = '<option value="">— Sin habitación —</option>' + this._habitaciones.map(h => `<option value="${h.HabitacionID}">${esc(h.NroHabitacion)}</option>`).join('');
        for (const id of ['mt-form-hab', 'mt-admin-hab']) { const el = document.getElementById(id); if (el) el.innerHTML = opts; }
        const mp = document.getElementById('mt-mat-prod');
        if (mp) {
            mp.innerHTML = '<option value="">— Material —</option>' + this._productos.map(x => `<option value="${x.ProductoID}">${esc(x.Nombre)} · ${Unidades.fmt(x.StockReal ?? x.StockActual, x.UnidadBase)}</option>`).join('');
            this.unidadMaterial();
        }
    },

    toggleHab() {
        const box = document.getElementById('mt-form-hab-box');
        if (box) box.style.display = document.getElementById('mt-form-area').value === 'HABITACION' ? '' : 'none';
    },

    unidadMaterial() {
        const p = this._productos.find(x => x.ProductoID === parseInt(document.getElementById('mt-mat-prod').value));
        document.getElementById('mt-mat-uni').innerHTML = Unidades.opciones(p ? p.UnidadBase : 'UND', p ? p.UnidadBase : 'UND');
    },

    async cargarMateriales() {
        const box = document.getElementById('mt-admin-mat');
        if (!box || !this._editId) return;
        try {
            const items = (await api.get(`/costo-habitacion/mantenimiento/${this._editId}/materiales`, { params: { sedeId: this._sedeId } })).data.items || [];
            const vivos = items.filter(m => !m.Devuelto);
            box.innerHTML = items.length ? `<table style="width:100%; border-collapse:collapse;">${items.map(m => `
                <tr style="${m.Devuelto ? 'opacity:.5; text-decoration:line-through;' : ''}">
                    <td>${esc(m.Nombre)}</td><td style="text-align:right;">${Unidades.fmt(m.Cantidad, m.UnidadBase)}</td>
                    <td style="text-align:right;">${money(m.CostoTotal)}</td>
                    <td style="text-align:right;">${m.Devuelto ? 'devuelto' : `<button class="btn-neo btn-sm" title="Devolver al inventario" onclick="MantenimientoModule.devolverMaterial(${m.MovimientoID})"><i class="fas fa-rotate-left"></i></button>`}</td>
                </tr>`).join('')}
                <tr><td colspan="2"><b>Total materiales</b></td><td style="text-align:right;"><b>${money(vivos.reduce((a, m) => a + Number(m.CostoTotal), 0))}</b></td><td></td></tr></table>`
                : '<span style="color:#718096;">Sin materiales cargados.</span>';
        } catch (e) { box.innerHTML = `<span style="color:#e74c3c;">${esc(e.response?.data?.error || e.message)}</span>`; }
    },

    async agregarMaterial() {
        const ProductoID = parseInt(document.getElementById('mt-mat-prod').value);
        const Cantidad = parseFloat(document.getElementById('mt-mat-cant').value);
        const Unidad = document.getElementById('mt-mat-uni').value;
        if (!ProductoID || !(Cantidad > 0)) return Swal.fire({ icon: 'warning', title: 'Elija el material y la cantidad', confirmButtonColor: '#1a365d' });
        try {
            const r = await api.post(`/costo-habitacion/mantenimiento/${this._editId}/materiales`, { sedeId: this._sedeId, lineas: [{ ProductoID, Cantidad, Unidad }] });
            window.Toast && window.Toast.fire({ icon: 'success', title: `Material descargado (${money(r.data.costo)})` });
            await Promise.all([this.cargarMateriales(), this.cargarCatalogos()]);
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'No se descargó', text: e.response?.data?.error || e.message, confirmButtonColor: '#1a365d' });
        }
    },

    async devolverMaterial(movId) {
        const { value: motivo } = await Swal.fire({
            title: 'Devolver material', input: 'text', inputPlaceholder: 'Motivo (p. ej. no se usó)', showCancelButton: true,
            confirmButtonText: 'Devolver', inputValidator: v => (!v || v.trim().length < 5) && 'Escriba el motivo',
        });
        if (!motivo) return;
        try {
            await api.post(`/costo-habitacion/material/${movId}/anular`, { sedeId: this._sedeId, motivo });
            await Promise.all([this.cargarMateriales(), this.cargarCatalogos()]);
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'No se devolvió', text: e.response?.data?.error || e.message, confirmButtonColor: '#1a365d' });
        }
    },

    async cargarStats() {
        try {
            const res = await api.get(`/mantenimiento/stats/${this._sedeId}`);
            const s = res.data;
            const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? '0'; };
            set('mt-cnt-pendiente', s.Pendientes);
            set('mt-cnt-proceso',   s.EnProceso);
            set('mt-cnt-resuelto',  s.Resueltos);
            set('mt-cnt-urgente',   s.Urgentes);
        } catch (_) {}
    },

    async cargarOrdenes() {
        const tabla = document.getElementById('mt-tabla');
        if (!tabla) return;
        tabla.innerHTML = `<div style="text-align:center;padding:40px;color:#718096;font-size:.85rem;"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>`;

        const area   = document.getElementById('mt-filtro-area')?.value   || '';
        const estado = document.getElementById('mt-filtro-estado')?.value || '';

        try {
            let url = `/mantenimiento/lista/${this._sedeId}?`;
            if (area)   url += `area=${area}&`;
            if (estado) url += `estado=${estado}&`;

            const res = await api.get(url);
            this._renderTabla(res.data.ordenes || []);
        } catch (_) {
            if (document.getElementById('mt-tabla'))
                document.getElementById('mt-tabla').innerHTML = `<p style="color:#e74c3c;padding:20px">Error cargando órdenes.</p>`;
        }
    },

    _renderTabla(ordenes) {
        const tabla = document.getElementById('mt-tabla');
        if (!tabla) return;
        window._mtOrdenes = ordenes;

        if (!ordenes.length) {
            tabla.innerHTML = `<p style="text-align:center;color:#718096;padding:30px;font-size:.85rem;">
                <i class="fas fa-check-circle" style="color:#27ae60"></i> Sin órdenes para los filtros seleccionados.</p>`;
            return;
        }

        const estadoBadge = { PENDIENTE:'b-pendiente', EN_PROCESO:'b-en_proceso', RESUELTO:'b-resuelto' };
        const prioBadge   = { URGENTE:'b-urgente', ALTA:'b-alta', MEDIA:'b-media', BAJA:'b-baja' };
        const areaIcon    = { HABITACION:'fa-bed', COCINA:'fa-fire-burner', RESTAURANTE:'fa-utensils',
                              PARQUEADERO:'fa-parking', EQUIPOS:'fa-plug', GENERAL:'fa-building' };

        const filas = ordenes.map(o => {
            const icon = areaIcon[o.Area] || 'fa-tools';
            const acciones = this._isAdmin
                ? `<button class="btn-neo btn-sm btn-prim" onclick="MantenimientoModule.abrirModalAdmin(${o.MantenimientoID})" title="Gestionar">
                       <i class="fas fa-cog"></i>
                   </button>`
                : `<span style="font-size:.7rem;color:#718096">${o.Estado === 'RESUELTO' ? 'Cerrada' : 'En revisión'}</span>`;
            return `
            <tr>
                <td><i class="fas ${icon}" style="color:var(--gold);margin-right:6px"></i><strong>${o.Area}</strong>
                    ${o.NroHabitacion ? `<span class="badge b-media" style="margin-left:4px;">HAB. ${esc(o.NroHabitacion)}</span>` : ''}
                    ${o.Referencia ? `<div style="font-size:.7rem;color:#718096">${esc(o.Referencia)}</div>` : ''}
                    ${Number(o.CostoMateriales) || Number(o.CostoManoObra) ? `<div style="font-size:.7rem;color:#718096">Costo ${money(Number(o.CostoMateriales) + Number(o.CostoManoObra))}</div>` : ''}</td>
                <td style="max-width:260px;font-size:.8rem">${o.Descripcion}</td>
                <td><span class="badge ${prioBadge[o.Prioridad] || 'b-media'}">${o.Prioridad}</span></td>
                <td><span class="badge ${estadoBadge[o.Estado] || 'b-media'}">${o.Estado.replace('_',' ')}</span></td>
                <td style="font-size:.75rem;color:#718096">${o.NombreReportante}<br>${o.FechaReporteFmt || ''}</td>
                <td style="font-size:.75rem;color:#718096">${o.AsignadoA || '—'}</td>
                <td>${acciones}</td>
            </tr>`;
        }).join('');

        tabla.innerHTML = `
        <table class="mt-table">
            <thead><tr>
                <th>Área</th><th>Descripción</th><th>Prioridad</th><th>Estado</th>
                <th>Reportado por</th><th>Asignado a</th><th>Acción</th>
            </tr></thead>
            <tbody>${filas}</tbody>
        </table>`;
    },

    abrirModalCrear() {
        document.getElementById('mt-form-area').value = 'HABITACION';
        document.getElementById('mt-form-ref').value  = '';
        document.getElementById('mt-form-desc').value = '';
        document.getElementById('mt-form-prio').value = 'MEDIA';
        document.getElementById('mt-form-hab').value  = '';
        this.toggleHab();
        document.getElementById('mt-overlay-crear').classList.add('visible');
    },

    abrirModalAdmin(id) {
        if (!this._isAdmin) return;
        const o = (window._mtOrdenes || []).find(x => x.MantenimientoID === id);
        this._editId = id;
        document.getElementById('mt-admin-id').textContent      = `#${id}`;
        document.getElementById('mt-admin-estado').value        = o?.Estado      || 'PENDIENTE';
        document.getElementById('mt-admin-asignado').value      = o?.AsignadoA   || '';
        document.getElementById('mt-admin-notas').value         = o?.NotasCierre || '';
        document.getElementById('mt-admin-hab').value           = o?.HabitacionID || '';
        document.getElementById('mt-admin-mo').value            = Number(o?.CostoManoObra) ? Number(o.CostoManoObra) : '';
        document.getElementById('mt-admin-mat').innerHTML       = '';
        document.getElementById('mt-overlay-admin').classList.add('visible');
        this.cargarMateriales();
    },

    cerrarModales() {
        document.getElementById('mt-overlay-crear')?.classList.remove('visible');
        document.getElementById('mt-overlay-admin')?.classList.remove('visible');
    },

    async guardarIncidencia() {
        const user   = JSON.parse(localStorage.getItem('user'));
        const area   = document.getElementById('mt-form-area').value;
        const ref    = document.getElementById('mt-form-ref').value.trim();
        const desc   = document.getElementById('mt-form-desc').value.trim();
        const prio   = document.getElementById('mt-form-prio').value;
        const hab    = area === 'HABITACION' ? document.getElementById('mt-form-hab').value : '';
        if (!desc) return Swal.fire({ icon:'warning', title:'Describe el problema', confirmButtonColor:'#1a365d' });

        try {
            await api.post('/mantenimiento/crear', {
                sedeId: this._sedeId, area, referencia: ref || undefined,
                descripcion: desc, prioridad: prio, habitacionId: hab || undefined
            });
            this.cerrarModales();
            Swal.fire({ icon:'success', title:'Incidencia reportada', text:'El equipo de mantenimiento será notificado.', timer:2500, showConfirmButton:false });
            await Promise.all([this.cargarOrdenes(), this.cargarStats()]);
        } catch (e) {
            Swal.fire({ icon:'error', title:'Error', text: e.response?.data?.error || e.message, confirmButtonColor:'#1a365d' });
        }
    },

    async guardarGestion() {
        const estado   = document.getElementById('mt-admin-estado').value;
        const asignado = document.getElementById('mt-admin-asignado').value.trim();
        const notas    = document.getElementById('mt-admin-notas').value.trim();
        const hab      = document.getElementById('mt-admin-hab').value;
        const mo       = document.getElementById('mt-admin-mo').value;
        try {
            await api.put(`/mantenimiento/${this._editId}`, {
                estado, asignadoA: asignado || undefined, notasCierre: notas || undefined,
                habitacionId: hab || undefined, costoManoObra: mo === '' ? undefined : mo
            });
            this.cerrarModales();
            Swal.fire({ icon:'success', title:'Orden actualizada', timer:1800, showConfirmButton:false });
            await Promise.all([this.cargarOrdenes(), this.cargarStats()]);
        } catch (e) {
            Swal.fire({ icon:'error', title:'Error', text: e.response?.data?.error || e.message, confirmButtonColor:'#1a365d' });
        }
    },

    destroy() {}
};

module.exports = MantenimientoModule;
