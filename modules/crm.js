const api = require('./api');

let _clienteActual = null;
let _searchTimer   = null;

const CRM = {

    async init() {
        window.CRM = this;
        await Promise.all([CRM.cargarStats(), CRM.cargarClientes('')]);
    },

    // ── STATS ──────────────────────────────────────────────────────────

    async cargarStats() {
        try {
            const r = await api.get('/crm/stats');
            const d = r.data;
            document.getElementById('sv-total').textContent  = d.TotalClientes    ?? '--';
            document.getElementById('sv-vip').textContent    = d.TotalVIP         ?? '--';
            document.getElementById('sv-nuevos').textContent = d.NuevosEsteMes    ?? '--';
            document.getElementById('sv-cumple').textContent = d.CumpleanosSemana ?? '--';
            document.getElementById('crm-total-badge').textContent = `${d.TotalClientes ?? 0} clientes`;
        } catch { /* silencioso */ }
    },

    // ── LISTA DE CLIENTES ──────────────────────────────────────────────

    async cargarClientes(buscar) {
        const el = document.getElementById('crm-grid');
        el.innerHTML = '<div class="crm-empty"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>';
        try {
            const params = buscar ? `?buscar=${encodeURIComponent(buscar)}` : '';
            const r = await api.get(`/crm/clientes${params}`);
            CRM.renderClientes(r.data);
        } catch {
            el.innerHTML = '<div class="crm-empty" style="color:#e74c3c;"><i class="fas fa-exclamation-triangle"></i> Error al cargar clientes.</div>';
        }
    },

    renderClientes(lista) {
        const el = document.getElementById('crm-grid');
        if (!lista.length) {
            el.innerHTML = '<div class="crm-empty">No se encontraron clientes con ese criterio.</div>';
            return;
        }
        el.innerHTML = lista.map(c => {
            const inicial      = (c.NombreFull || '?')[0].toUpperCase();
            const ultimaVisita = c.UltimaVisita
                ? new Date(c.UltimaVisita).toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' })
                : 'Sin visitas';
            const gastado = parseFloat(c.TotalGastado || 0).toFixed(2);
            const proc    = c.Procedencia ? ` · ${c.Procedencia}` : '';
            return `
            <div class="cliente-card" onclick="CRM.abrirPerfil(${c.ClienteID})">
                <div class="card-top">
                    <div class="card-avatar">${inicial}</div>
                    <div class="card-nombre">
                        <h4>${c.NombreFull || 'Sin nombre'}</h4>
                        <p>${c.Documento || 'Sin doc.'}${proc}</p>
                    </div>
                    <span class="clasif-badge badge-${c.Clasificacion}">${CRM._labelClasif(c.Clasificacion)}</span>
                </div>
                <div class="card-footer">
                    <div class="c-stat">
                        <span>Visitas</span>
                        <strong>${c.TotalVisitas}</strong>
                    </div>
                    <div class="c-sep"></div>
                    <div class="c-stat">
                        <span>Total gastado</span>
                        <strong>$${gastado}</strong>
                    </div>
                    <div class="c-sep"></div>
                    <div class="c-stat">
                        <span>&Uacute;ltima visita</span>
                        <strong style="font-size:0.72rem;">${ultimaVisita}</strong>
                    </div>
                </div>
            </div>`;
        }).join('');
    },

    onSearch(val) {
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(() => CRM.cargarClientes(val.trim()), 350);
    },

    // ── TABS PRINCIPALES ───────────────────────────────────────────────

    switchTab(tab, btn) {
        document.querySelectorAll('.tab-crm').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-clientes').style.display    = tab === 'clientes'   ? '' : 'none';
        document.getElementById('tab-cumpleanos').style.display  = tab === 'cumpleanos' ? '' : 'none';
        document.getElementById('crm-searchbar').style.display   = tab === 'clientes'   ? '' : 'none';
        if (tab === 'cumpleanos') CRM.cargarCumpleanos();
    },

    // ── CUMPLEAÑOS ─────────────────────────────────────────────────────

    async cargarCumpleanos() {
        const el = document.getElementById('crm-cumple-lista');
        el.innerHTML = '<div class="crm-empty"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>';
        try {
            const r = await api.get('/crm/cumpleanos');
            CRM.renderCumpleanos(r.data);
        } catch {
            el.innerHTML = '<div class="crm-empty" style="color:#e74c3c;">Error al cargar.</div>';
        }
    },

    renderCumpleanos(lista) {
        const el = document.getElementById('crm-cumple-lista');
        if (!lista.length) {
            el.innerHTML = '<div class="crm-empty"><i class="fas fa-check-circle" style="color:#27ae60;"></i> No hay cumpleaños en los próximos 30 días.</div>';
            return;
        }
        el.innerHTML = lista.map(c => {
            const esHoy = c.DiasRestantes === 0;
            const fecha = c.FechaNacimiento
                ? new Date(c.FechaNacimiento).toLocaleDateString('es-EC', { day: '2-digit', month: 'long', timeZone: 'UTC' })
                : '';
            return `
            <div class="cumple-card" onclick="CRM.abrirPerfil(${c.ClienteID})">
                <div class="cumple-dias">
                    <span class="num">${esHoy ? '🎂' : c.DiasRestantes}</span>
                    <span class="lbl">${esHoy ? 'HOY' : 'días'}</span>
                </div>
                <div class="cumple-info">
                    <h4>${c.NombreFull}</h4>
                    <p>${c.Documento || ''} · ${fecha}${c.Telefono ? ' · ' + c.Telefono : ''}</p>
                    ${c.Correo ? `<p style="color:#3498db; font-size:0.75rem;">${c.Correo}</p>` : ''}
                </div>
                ${esHoy ? '<span class="cumple-hoy">¡HOY!</span>' : ''}
            </div>`;
        }).join('');
    },

    // ── MODAL PERFIL ───────────────────────────────────────────────────

    async abrirPerfil(id) {
        _clienteActual = id;
        const overlay = document.getElementById('crm-overlay');
        overlay.style.display = 'flex';
        // Reset
        document.getElementById('m-historial-body').innerHTML =
            '<tr><td colspan="8" style="text-align:center;padding:25px;color:#718096;"><i class="fas fa-spinner fa-spin"></i></td></tr>';
        document.getElementById('notas-lista').innerHTML = '';
        document.getElementById('m-edit-form').style.display = 'none';
        document.getElementById('nota-input').value = '';
        // Siempre arrancar en pestaña historial
        CRM.switchModalTab('historial', document.getElementById('mtab-historial'));

        try {
            const r = await api.get(`/crm/clientes/${id}`);
            CRM.renderPerfil(r.data);
        } catch {
            Swal.fire('Error', 'No se pudo cargar el perfil del cliente.', 'error');
            CRM.cerrarModal();
        }
    },

    renderPerfil({ perfil, historial, notas, tipoFavorito }) {
        const inicial = (perfil.NombreFull || '?')[0].toUpperCase();
        document.getElementById('m-avatar').textContent  = inicial;
        document.getElementById('m-nombre').textContent  = perfil.NombreFull || 'Sin nombre';
        document.getElementById('m-doc-tel').textContent =
            [perfil.Documento, perfil.Telefono, perfil.Correo, perfil.Procedencia]
            .filter(Boolean).join(' · ');

        const badge = document.getElementById('m-badge');
        badge.textContent = CRM._labelClasif(perfil.Clasificacion);
        badge.className   = `clasif-badge badge-${perfil.Clasificacion}`;

        // KPIs
        const promedio = perfil.PromedioHoras > 0
            ? (perfil.PromedioHoras / 24).toFixed(1) + ' días'
            : '--';
        const fnac = perfil.FechaNacimiento
            ? new Date(perfil.FechaNacimiento).toLocaleDateString('es-EC', { day:'2-digit', month:'long', timeZone: 'UTC' })
            : '--';
        document.getElementById('m-kpis').innerHTML = `
            <div class="kpi-cell"><span>Total visitas</span><strong>${perfil.TotalVisitas}</strong></div>
            <div class="kpi-cell"><span>Total gastado</span><strong>$${parseFloat(perfil.TotalGastado||0).toFixed(2)}</strong></div>
            <div class="kpi-cell"><span>Estadía promedio</span><strong>${promedio}</strong></div>
            <div class="kpi-cell"><span>${tipoFavorito ? 'Hab. favorita' : 'Cumplea&ntilde;os'}</span>
                <strong style="font-size:0.82rem;">${tipoFavorito || fnac}</strong></div>
        `;

        // Botón de correo — solo si el cliente tiene email
        const btnEmail = document.getElementById('m-btn-email');
        if (btnEmail) btnEmail.style.display = perfil.Correo ? '' : 'none';

        // Formulario de edición
        document.getElementById('e-nombre').value      = perfil.NombreFull      || '';
        document.getElementById('e-telefono').value    = perfil.Telefono        || '';
        document.getElementById('e-correo').value      = perfil.Correo          || '';
        document.getElementById('e-procedencia').value = perfil.Procedencia     || '';
        document.getElementById('e-fnac').value        = perfil.FechaNacimiento
            ? perfil.FechaNacimiento.split('T')[0]
            : '';
        document.getElementById('e-direccion').value   = perfil.Direccion        || '';

        // Historial
        if (!historial.length) {
            document.getElementById('m-historial-body').innerHTML =
                '<tr><td colspan="8" style="text-align:center;padding:25px;color:#718096;">Sin estadías registradas.</td></tr>';
        } else {
            document.getElementById('m-historial-body').innerHTML = historial.map(h => {
                const entrada = new Date(h.FechaEntrada)
                    .toLocaleString('es-EC', { dateStyle:'short', timeStyle:'short' });
                const salidaFecha = h.FechaSalidaReal || h.FechaSalidaProgramada;
                const salida = salidaFecha
                    ? new Date(salidaFecha).toLocaleString('es-EC', { dateStyle:'short', timeStyle:'short' })
                      + (h.FechaSalidaReal ? '' : ' <span style="opacity:0.6;font-size:0.7em;">(prog.)</span>')
                    : '--';
                const colorPago = h.EstadoPago === 'PAGADO' ? '#27ae60' : '#e74c3c';
                return `<tr style="border-bottom:1px solid #f1f5f9;">
                    <td style="padding:9px 12px; white-space:nowrap; font-size:0.78rem;">${entrada}</td>
                    <td style="padding:9px 12px; white-space:nowrap; font-size:0.78rem;">${salida}</td>
                    <td style="padding:9px 12px; font-weight:800; color:#1a365d;">${h.NroHabitacion}</td>
                    <td style="padding:9px 12px; font-size:0.78rem;">${h.TipoHabitacion}</td>
                    <td style="padding:9px 12px; font-size:0.78rem;">${h.TipoAlquiler || '--'}</td>
                    <td style="padding:9px 12px; font-weight:900;">$${parseFloat(h.TotalHospedaje||0).toFixed(2)}</td>
                    <td style="padding:9px 12px;"><span style="color:${colorPago}; font-weight:800; font-size:0.78rem;">${h.EstadoPago||'--'}</span></td>
                    <td style="padding:9px 12px; font-size:0.78rem; color:#718096;">${h.Sede}</td>
                </tr>`;
            }).join('');
        }

        // Notas
        const cnt = notas.length;
        document.getElementById('m-notas-count').textContent = cnt > 0 ? `(${cnt})` : '';
        CRM.renderNotas(notas);
    },

    renderNotas(notas) {
        const el = document.getElementById('notas-lista');
        if (!notas.length) {
            el.innerHTML = '<p style="color:#718096; text-align:center; font-size:0.85rem;">Sin notas registradas.</p>';
            return;
        }
        el.innerHTML = notas.map(n => {
            const fecha = new Date(n.FechaCreacion)
                .toLocaleString('es-EC', { dateStyle:'short', timeStyle:'short' });
            return `<div class="nota-item">
                <p>${n.Nota}</p>
                <p class="nota-meta"><i class="fas fa-user"></i> ${n.NombreUsuario} &nbsp;·&nbsp; <i class="fas fa-clock"></i> ${fecha}</p>
            </div>`;
        }).join('');
    },

    switchModalTab(tab, btn) {
        document.querySelectorAll('.mtab').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
        document.getElementById('mt-historial').style.display = tab === 'historial' ? '' : 'none';
        document.getElementById('mt-notas').style.display     = tab === 'notas'     ? '' : 'none';
    },

    toggleEdit() {
        const f = document.getElementById('m-edit-form');
        f.style.display = f.style.display === 'none' ? '' : 'none';
    },

    cancelarEdit() {
        document.getElementById('m-edit-form').style.display = 'none';
    },

    async guardarCliente() {
        const body = {
            NombreFull:      document.getElementById('e-nombre').value.trim(),
            Telefono:        document.getElementById('e-telefono').value.trim()      || null,
            Correo:          document.getElementById('e-correo').value.trim()        || null,
            Procedencia:     document.getElementById('e-procedencia').value.trim()   || null,
            FechaNacimiento: document.getElementById('e-fnac').value                 || null,
            Direccion:       document.getElementById('e-direccion').value.trim()     || null
        };
        if (!body.NombreFull)
            return Swal.fire('Atención', 'El nombre no puede estar vacío.', 'warning');

        try {
            await api.put(`/crm/clientes/${_clienteActual}`, body);
            document.getElementById('m-edit-form').style.display = 'none';
            Swal.fire({ icon:'success', title:'Guardado', text:'Datos actualizados.', timer:1500, showConfirmButton:false });
            // Refrescar perfil y lista
            const r = await api.get(`/crm/clientes/${_clienteActual}`);
            CRM.renderPerfil(r.data);
            CRM.cargarClientes(document.getElementById('crm-buscar')?.value || '');
            CRM.cargarStats();
        } catch {
            Swal.fire('Error', 'No se pudo guardar los datos.', 'error');
        }
    },

    async agregarNota() {
        const nota = document.getElementById('nota-input').value.trim();
        if (!nota) return Swal.fire('Atención', 'La nota no puede estar vacía.', 'warning');
        try {
            await api.post(`/crm/clientes/${_clienteActual}/notas`, { nota });
            document.getElementById('nota-input').value = '';
            const r = await api.get(`/crm/clientes/${_clienteActual}`);
            CRM.renderNotas(r.data.notas);
            const cnt = r.data.notas.length;
            document.getElementById('m-notas-count').textContent = cnt > 0 ? `(${cnt})` : '';
        } catch {
            Swal.fire('Error', 'No se pudo agregar la nota.', 'error');
        }
    },

    async abrirEnvioEmail() {
        const { value: form } = await Swal.fire({
            title: 'Enviar correo al cliente',
            html: `
                <div style="text-align:left; font-size:0.88rem;">
                    <label style="display:block; font-weight:700; color:#718096; text-transform:uppercase; font-size:0.72rem; margin-bottom:6px;">Tipo de mensaje</label>
                    <select id="swal-tipo" style="width:100%; padding:9px 12px; border:1px solid #e2e8f0; border-radius:8px; font-size:0.88rem; margin-bottom:14px; outline:none;">
                        <option value="CUMPLEANOS">🎂 Saludo de cumpleaños</option>
                        <option value="OFERTA">✨ Oferta especial</option>
                        <option value="BIENVENIDA">🏨 Te esperamos / Vuelve pronto</option>
                        <option value="PERSONALIZADO">✉️ Mensaje personalizado</option>
                    </select>
                    <label style="display:block; font-weight:700; color:#718096; text-transform:uppercase; font-size:0.72rem; margin-bottom:6px;">
                        Descuento a incluir <span style="font-weight:400; text-transform:none;">(opcional — dejar vacío si no aplica)</span>
                    </label>
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:14px;">
                        <input id="swal-descuento" type="number" min="1" max="99" placeholder="ej: 15"
                            style="width:90px; padding:9px 12px; border:1px solid #e2e8f0; border-radius:8px; font-size:0.88rem; outline:none;">
                        <span style="color:#718096; font-size:0.9rem;">% de descuento en próxima visita</span>
                    </div>
                    <label style="display:block; font-weight:700; color:#718096; text-transform:uppercase; font-size:0.72rem; margin-bottom:6px;">
                        Mensaje adicional <span style="font-weight:400; text-transform:none;">(opcional)</span>
                    </label>
                    <textarea id="swal-mensaje" rows="3" placeholder="Texto libre que se añade al correo..."
                        style="width:100%; padding:9px 12px; border:1px solid #e2e8f0; border-radius:8px; font-size:0.88rem; resize:none; box-sizing:border-box; font-family:'Segoe UI',sans-serif; outline:none;"></textarea>
                    <p style="margin:12px 0 0; color:#a0aec0; font-size:0.72rem; line-height:1.4;">
                        <i class="fas fa-shield-alt"></i>
                        El correo <strong>no menciona estadías, fechas ni acompañantes</strong>. Solo comunicación comercial del hotel.
                    </p>
                </div>`,
            confirmButtonText: '<i class="fas fa-paper-plane"></i> Enviar',
            confirmButtonColor: '#1a365d',
            cancelButtonText: 'Cancelar',
            showCancelButton: true,
            focusConfirm: false,
            preConfirm: () => ({
                tipo:         document.getElementById('swal-tipo').value,
                descuento:    document.getElementById('swal-descuento').value || null,
                mensajeExtra: document.getElementById('swal-mensaje').value.trim() || null
            })
        });

        if (!form) return;

        try {
            const user = JSON.parse(localStorage.getItem('user') || '{}');
            const sedeId = localStorage.getItem('currentSedeId') || user.sede || null;

            const r = await api.post(`/crm/clientes/${_clienteActual}/email`, { ...form, sedeId });
            Swal.fire({
                icon: 'success',
                title: 'Correo enviado',
                text: r.data.message,
                timer: 2500,
                showConfirmButton: false
            });
            // Refrescar notas para mostrar el registro automático del envío
            const perfil = await api.get(`/crm/clientes/${_clienteActual}`);
            CRM.renderNotas(perfil.data.notas);
            const cnt = perfil.data.notas.length;
            document.getElementById('m-notas-count').textContent = cnt > 0 ? `(${cnt})` : '';
        } catch (err) {
            const msg = err.response?.data?.error || 'No se pudo enviar el correo.';
            Swal.fire('Error', msg, 'error');
        }
    },

    cerrarModal(e) {
        if (!e || e.target === document.getElementById('crm-overlay')) {
            document.getElementById('crm-overlay').style.display = 'none';
            _clienteActual = null;
        }
    },

    // ── HELPERS ────────────────────────────────────────────────────────

    _labelClasif(c) {
        return { VIP:'VIP', FRECUENTE:'Frecuente', REGULAR:'Regular', NUEVO:'Nuevo', SIN_ACTIVIDAD:'Sin actividad' }[c] || c;
    }
};

module.exports = CRM;
