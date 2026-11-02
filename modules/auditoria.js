const api = require('./api');

const AuditoriaModule = {
    async init() {
        window.AuditoriaModule = this;
        App.renderSedeSelector('audit-sede-selector', () => {});
        this.setFechasHoy();
        await this.cargarLogs();
    },

    setFechasHoy() {
        const hoy = new Date().toISOString().slice(0, 10);
        const inicio = document.getElementById('audit-fecha-inicio');
        const fin    = document.getElementById('audit-fecha-fin');
        if (inicio) inicio.value = hoy;
        if (fin)    fin.value    = hoy;
    },

    alternarIntegridad() {
        const panel = document.getElementById('audit-integridad');
        const bit = document.getElementById('audit-bitacora');
        const btn = document.getElementById('audit-btn-integridad');
        const abrir = panel.style.display === 'none';
        panel.style.display = abrir ? 'block' : 'none';
        bit.style.display = abrir ? 'none' : 'block';
        document.getElementById('audit-badge').style.display = abrir ? 'none' : '';
        btn.innerHTML = abrir ? '<i class="fas fa-list"></i> VER BITÁCORA' : '<i class="fas fa-stethoscope"></i> PRUEBA DE INTEGRIDAD';
        if (abrir && !this._integridad) this.correrIntegridad();
    },

    async correrIntegridad() {
        const res = document.getElementById('int-resumen');
        const lista = document.getElementById('int-lista');
        const sedeId = document.getElementById('globalSedeSelector')?.value || '';
        res.innerHTML = '<div style="color:#718096;font-size:0.8rem;"><i class="fas fa-spinner fa-spin"></i> Revisando... puede tardar unos segundos.</div>';
        lista.innerHTML = '';
        try {
            const { data } = await api.get(`/auditoria/integridad${sedeId ? '?sedeId=' + sedeId : ''}`);
            this._integridad = data;
            const r = data.resumen;
            const chip = (txt, color) => `<span style="background:${color}20;color:${color};border:1px solid ${color}40;border-radius:12px;padding:5px 12px;font-size:0.75rem;font-weight:900;">${txt}</span>`;
            res.innerHTML = `<div style="display:flex;gap:10px;flex-wrap:wrap;">
                ${chip(r.revisadas + ' revisiones', '#1a365d')}
                ${chip(r.conProblemas ? r.conProblemas + ' con hallazgos' : 'Todo cuadra', r.conProblemas ? '#e67e22' : '#27ae60')}
                ${r.altas ? chip(r.altas + ' graves', '#e74c3c') : ''}
                ${r.errores ? chip(r.errores + ' sin revisar', '#7f8c8d') : ''}</div>`;
            const colores = { ALTA: '#e74c3c', MEDIA: '#e67e22', INFO: '#2980b9' };
            lista.innerHTML = data.resultados.map((x, i) => {
                const mal = x.cantidad > 0 || !!x.error;
                const color = mal ? (x.error ? '#7f8c8d' : colores[x.gravedad]) : '#27ae60';
                const icono = !mal ? 'fa-check-circle' : x.error ? 'fa-question-circle' : 'fa-exclamation-triangle';
                const tabla = x.detalle && x.detalle.length ? this._tabla(x.detalle) : '';
                const pie = !mal ? '' : x.error
                    ? `<div style="margin-top:8px;font-size:0.75rem;color:#4a5568;"><b>${x.error}</b></div>`
                    : `<div style="margin-top:8px;font-size:0.75rem;color:#4a5568;"><b>Cómo corregir:</b> ${x.comoCorregir || ''}</div>`;
                return `<div style="background:#e0e0e4;border-radius:16px;padding:14px 18px;margin-bottom:10px;box-shadow:4px 4px 8px #bebebe,-4px -4px 8px #ffffff;border-left:5px solid ${color};">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;${tabla ? 'cursor:pointer;' : ''}" ${tabla ? `onclick="AuditoriaModule.verDetalle(${i})"` : ''}>
                        <div style="display:flex;gap:10px;align-items:center;">
                            <i class="fas ${icono}" style="color:${color};font-size:1.1rem;"></i>
                            <div>
                                <div style="font-weight:800;color:#2d3748;font-size:0.82rem;">${x.titulo}</div>
                                <div style="font-size:0.65rem;color:#718096;font-weight:700;text-transform:uppercase;">${x.modulo}${mal && !x.error ? ' · ' + x.gravedad : ''}</div>
                            </div>
                        </div>
                        <div style="font-weight:900;color:${color};font-size:0.9rem;white-space:nowrap;">${x.error ? 'No se pudo revisar' : mal ? x.cantidad : 'OK'}${tabla ? ' <i class="fas fa-chevron-down" style="font-size:0.7rem;"></i>' : ''}</div>
                    </div>
                    ${pie}
                    <div id="int-det-${i}" style="display:none;margin-top:10px;overflow-x:auto;">${tabla}</div>
                </div>`;
            }).join('');
        } catch (err) {
            res.innerHTML = `<div style="color:#e74c3c;font-size:0.8rem;">${err.response?.data?.error || err.response?.data?.message || 'No se pudo correr la revisión.'}</div>`;
        }
    },

    verDetalle(i) {
        const d = document.getElementById('int-det-' + i);
        if (d) d.style.display = d.style.display === 'none' ? 'block' : 'none';
    },

    _tabla(filas) {
        const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const cols = Object.keys(filas[0]);
        return `<table style="width:100%;border-collapse:collapse;font-size:0.72rem;">
            <thead><tr>${cols.map(c => `<th style="text-align:left;padding:6px 8px;color:#718096;font-size:0.6rem;text-transform:uppercase;border-bottom:1px solid #c8c8cc;">${esc(c)}</th>`).join('')}</tr></thead>
            <tbody>${filas.map(f => `<tr>${cols.map(c => `<td style="padding:5px 8px;color:#2d3748;border-bottom:1px solid rgba(0,0,0,0.04);">${esc(f[c])}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>${filas.length >= 50 ? '<div style="font-size:0.65rem;color:#a0aec0;margin-top:4px;">Se muestran los primeros 50.</div>' : ''}`;
    },

    async cargarLogs() {
        const tbody  = document.getElementById('audit-tabla-body');
        const badge  = document.getElementById('audit-badge');
        const inicio = document.getElementById('audit-fecha-inicio')?.value;
        const fin    = document.getElementById('audit-fecha-fin')?.value;
        const modulo = document.getElementById('audit-modulo')?.value;
        const sedeId = document.getElementById('globalSedeSelector')?.value || '';

        if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:#a0aec0;"><i class="fas fa-spinner fa-spin"></i> Cargando...</td></tr>`;

        try {
            const params = new URLSearchParams();
            if (inicio) params.append('fechaInicio', inicio);
            if (fin)    params.append('fechaFin', fin);
            if (modulo) params.append('modulo', modulo);
            if (sedeId) params.append('sedeId', sedeId);

            const res = await api.get(`/auditoria?${params.toString()}`);
            const logs = res.data;

            if (badge) badge.textContent = `${logs.length} registros`;

            if (!logs.length) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:#a0aec0;">Sin registros para el período seleccionado</td></tr>`;
                return;
            }

            const colorAccion = {
                LOGIN_EXITOSO:    '#27ae60',
                LOGIN_FALLIDO:    '#e74c3c',
                ABRIR_CAJA:       '#2980b9',
                CERRAR_CAJA:      '#8e44ad',
                MOVIMIENTO_CAJA:  '#f39c12',
                REABRIR_CAJA:     '#e67e22',
                ANULAR_MOVIMIENTO:'#e74c3c',
                ANULAR_CHECKIN:   '#e74c3c',
                CHECK_IN:         '#27ae60',
                CHECK_OUT:        '#16a085',
                EMITIR_FACTURA:   '#9b59b6',
                CREAR_USUARIO:    '#2980b9',
                ACTUALIZAR_USUARIO:'#f39c12',
                DESACTIVAR_USUARIO:'#e74c3c',
                GUARDAR_SEDE:     '#34495e'
            };

            tbody.innerHTML = logs.map(r => {
                const color = colorAccion[r.Accion] || '#718096';
                return `
                    <tr style="border-bottom:1px solid rgba(0,0,0,0.04);">
                        <td style="padding:10px 12px; color:#2d3748; font-weight:700; white-space:nowrap; font-size:0.75rem;">${r.FechaHoraFmt}</td>
                        <td style="padding:10px 12px; color:#1a365d; font-weight:700;">${r.NombreUsuario}</td>
                        <td style="padding:10px 12px; color:#718096; font-size:0.75rem;">${r.NombreSede}</td>
                        <td style="padding:10px 12px;">
                            <span style="background:#e0e0e4; border-radius:8px; padding:3px 8px; font-size:0.65rem; font-weight:900; color:#2d3748; box-shadow:2px 2px 4px #bebebe;">${r.Modulo}</span>
                        </td>
                        <td style="padding:10px 12px;">
                            <span style="background:${color}20; color:${color}; border-radius:8px; padding:3px 10px; font-size:0.65rem; font-weight:900; border:1px solid ${color}40;">${r.Accion}</span>
                        </td>
                        <td style="padding:10px 12px; color:#4a5568; font-size:0.75rem; max-width:350px;">${r.Descripcion || ''}</td>
                        <td style="padding:10px 12px; color:#a0aec0; font-size:0.7rem; font-family:monospace;">${r.IP || ''}</td>
                    </tr>
                `;
            }).join('');
        } catch (err) {
            console.error('Error cargando auditoría', err);
            if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:#e74c3c;">Error al cargar registros</td></tr>`;
        }
    }
};

module.exports = AuditoriaModule;
