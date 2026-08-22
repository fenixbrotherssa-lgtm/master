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
