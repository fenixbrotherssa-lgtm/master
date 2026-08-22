const api = require('./api');

const MantenimientoModule = {
    _sedeId: null,
    _isAdmin: false,
    _editId: null,

    async init() {
        window.MantenimientoModule = this;
        const user = JSON.parse(localStorage.getItem('user'));
        this._isAdmin = user && parseInt(user.RolID) === 1;
        this._sedeId  = localStorage.getItem('currentSedeId') || user?.SedeID || 1;
        await Promise.all([this.cargarOrdenes(), this.cargarStats()]);
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
                    ${o.Referencia ? `<div style="font-size:.7rem;color:#718096">${o.Referencia}</div>` : ''}</td>
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
        document.getElementById('mt-overlay-admin').classList.add('visible');
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
        if (!desc) return Swal.fire({ icon:'warning', title:'Describe el problema', confirmButtonColor:'#1a365d' });

        try {
            await api.post('/mantenimiento/crear', {
                sedeId: this._sedeId, area, referencia: ref || undefined,
                descripcion: desc, prioridad: prio
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
        try {
            await api.put(`/mantenimiento/${this._editId}`, { estado, asignadoA: asignado || undefined, notasCierre: notas || undefined });
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
