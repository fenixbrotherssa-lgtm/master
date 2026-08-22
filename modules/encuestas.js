const api = require('./api');

const EncuestasModule = {
    _sedeId: null,
    _encuestas: [],

    async init() {
        window.EncuestasModule = this;
        this._sedeId = localStorage.getItem('currentSedeId') || App.user?.SedeID;

        // Fecha inicial: mes actual
        const hoy = new Date();
        const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
        const ultimoDia = hoy.toISOString().split('T')[0];
        const elDesde = document.getElementById('enc-desde');
        const elHasta = document.getElementById('enc-hasta');
        if (elDesde && !elDesde.value) elDesde.value = primerDia;
        if (elHasta && !elHasta.value) elHasta.value = ultimoDia;

        await Promise.all([this._cargarStats(), this.cargar()]);
    },

    async _cargarStats() {
        try {
            const r = await api.get(`/encuestas/stats/${this._sedeId}`);
            const d = r.data;
            const set = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = val !== null && val !== undefined ? val : '—';
            };
            set('enc-st-total',       d.Total       || 0);
            set('enc-st-completadas', d.Completadas  || 0);
            set('enc-st-hab',  d.AvgHabitacion  !== null ? d.AvgHabitacion  : '—');
            set('enc-st-limp', d.AvgLimpieza    !== null ? d.AvgLimpieza    : '—');
            set('enc-st-aten', d.AvgAtencion    !== null ? d.AvgAtencion    : '—');
            set('enc-st-cal',  d.AvgCalidad     !== null ? d.AvgCalidad     : '—');
            set('enc-st-gen',  d.AvgGeneral     !== null ? d.AvgGeneral     : '—');
        } catch (_) {}
    },

    async cargar() {
        const desde = document.getElementById('enc-desde')?.value || '';
        const hasta = document.getElementById('enc-hasta')?.value || '';
        const contenido = document.getElementById('enc-tabla-contenido');
        if (!contenido) return;

        contenido.innerHTML = `<div style="text-align:center;padding:40px;color:#718096;font-size:.85rem;"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>`;
        try {
            const params = new URLSearchParams();
            if (desde) params.append('desde', desde);
            if (hasta) params.append('hasta', hasta);
            const r = await api.get(`/encuestas/resultados/${this._sedeId}?${params}`);
            this._encuestas = r.data.encuestas || [];
            this._renderTabla();
        } catch (err) {
            contenido.innerHTML = `<div style="text-align:center;padding:40px;color:#e74c3c;font-size:.85rem;"><i class="fas fa-exclamation-triangle"></i> Error al cargar: ${err.message}</div>`;
        }
    },

    limpiarFiltros() {
        const hoy = new Date();
        const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
        const elDesde = document.getElementById('enc-desde');
        const elHasta = document.getElementById('enc-hasta');
        if (elDesde) elDesde.value = primerDia;
        if (elHasta) elHasta.value = hoy.toISOString().split('T')[0];
        this.cargar();
    },

    _renderTabla() {
        const contenido = document.getElementById('enc-tabla-contenido');
        if (!contenido) return;
        if (!this._encuestas.length) {
            contenido.innerHTML = `<div style="text-align:center;padding:40px;color:#718096;font-size:.85rem;"><i class="fas fa-inbox"></i> Sin encuestas en este período</div>`;
            return;
        }

        const filas = this._encuestas.map((e, i) => {
            const completada = e.Estado === 'COMPLETADA';
            const badge = completada
                ? `<span class="badge badge-ok">Completada</span>`
                : `<span class="badge badge-pending">Pendiente</span>`;
            const stars = n => n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '—';
            const comentEl = e.Comentario
                ? `<span class="comentario-cell" title="${this._esc(e.Comentario)}" onclick="EncuestasModule.verComentario(${i})">${this._esc(e.Comentario.substring(0,40))}${e.Comentario.length > 40 ? '…' : ''}</span>`
                : `<span style="color:#aaa;font-size:.75rem;">Sin comentario</span>`;

            return `<tr>
                <td>${this._esc(e.NombreHuesped)}</td>
                <td style="color:#718096;font-size:.75rem">${e.EmailHuesped || '—'}</td>
                <td>${e.FechaEnvioFmt || '—'}</td>
                <td>${badge}</td>
                <td style="color:#c5a059;font-size:.9rem">${stars(e.PuntajeHabitacion)}</td>
                <td style="color:#c5a059;font-size:.9rem">${stars(e.PuntajeLimpieza)}</td>
                <td style="color:#c5a059;font-size:.9rem">${stars(e.PuntajeAtencion)}</td>
                <td style="color:#c5a059;font-size:.9rem">${stars(e.PuntajeCalidadPrecio)}</td>
                <td style="color:#c5a059;font-size:.9rem">${stars(e.PuntajeGeneral)}</td>
                <td>${comentEl}</td>
            </tr>`;
        }).join('');

        contenido.innerHTML = `
            <table class="enc-table">
                <thead>
                    <tr>
                        <th>Huésped</th>
                        <th>Correo</th>
                        <th>Enviada</th>
                        <th>Estado</th>
                        <th>Habitación</th>
                        <th>Limpieza</th>
                        <th>Atención</th>
                        <th>Calidad/Precio</th>
                        <th>Recomendaría</th>
                        <th>Comentario</th>
                    </tr>
                </thead>
                <tbody>${filas}</tbody>
            </table>`;
    },

    verComentario(idx) {
        const e = this._encuestas[idx];
        if (!e?.Comentario) return;
        Swal.fire({
            title: `Comentario de ${e.NombreHuesped}`,
            text: e.Comentario,
            icon: 'info',
            confirmButtonColor: '#1a365d'
        });
    },

    _esc(str) {
        if (!str) return '';
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
};

module.exports = EncuestasModule;
