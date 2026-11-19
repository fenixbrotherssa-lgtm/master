// modules/avisoPersonal.js — Aviso del administrador al personal (2.4.1)
// Mismo archivo en el escritorio (require) y en la app móvil (cargarModulo).
//
// El SuperAdmin deja un mensaje por sede ("Prohibido realizar adelantos de caja y
// créditos sin autorización", etc.). Se muestra como cuadro de diálogo:
//   · SIEMPRE  → cada vez que alguien entra al sistema (una vez por sesión de la app)
//   · UNA_VEZ  → una sola vez por usuario y equipo (hasta que el aviso cambie)
// Si el administrador lo cambia con la app abierta, llega al instante por Socket.io.
// No es un módulo nuevo: el botón 📢 está en la barra superior (escritorio) y en "MÁS" (móvil).
const api = require('./api');

const TIPOS = {
    PROHIBIDO:   { color: '#e11d48', fondo: '#fff1f2', icono: 'fa-ban',                  etiqueta: 'PROHIBIDO' },
    ADVERTENCIA: { color: '#d97706', fondo: '#fffbeb', icono: 'fa-triangle-exclamation', etiqueta: 'IMPORTANTE' },
    INFO:        { color: '#2563eb', fondo: '#eff6ff', icono: 'fa-circle-info',          etiqueta: 'INFORMACIÓN' }
};

const PLANTILLAS = [
    'Prohibido realizar adelantos de caja y créditos sin autorización del administrador.',
    'Todo egreso de caja debe tener su comprobante o factura.',
    'Antes de entregar el turno, cuadre la caja y revise el inventario.',
    'No se aceptan descuentos ni cortesías sin autorización.'
];

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function usuario() { try { return JSON.parse(localStorage.getItem('user')) || null; } catch (_) { return null; } }
function esAdmin() { const u = usuario(); return !!u && parseInt(u.RolID || u.rol) === 1; }
function sedeActual() { const u = usuario(); return localStorage.getItem('currentSedeId') || (u ? u.SedeID : null); }
function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* sin almacenamiento */ } }
function ssGet(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } }
function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (_) { /* sin almacenamiento */ } }

// Clave por usuario y sede. En "SIEMPRE" va también un trozo del token: cada nuevo inicio de sesión lo vuelve a mostrar.
function claveVisto(sede, sesion) {
    const u = usuario() || {};
    return `mh_aviso_${sede}_${u.UsuarioID || u.id || 0}` + (sesion ? '_' + String(lsGet('token') || '').slice(-12) : '');
}

function fechaCorta(iso) {
    try { return new Date(iso).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' }); } catch (_) { return ''; }
}

const AvisoPersonal = {
    _ultimo: null,
    _pendiente: null,

    /** Muestra el aviso vigente de la sede si corresponde. forzar = mostrarlo igual (botón "ver aviso"). */
    async mostrar(opts = {}) {
        const sede = opts.sedeId || sedeActual();
        if (!sede || !usuario()) return;
        let aviso = opts.aviso;
        if (!aviso) {
            try {
                const r = await api.get('/config-sede/aviso', { params: { sedeId: sede } });
                aviso = r.data && r.data.aviso;
            } catch (_) { return; }  // sin servidor o versión anterior: no molestar
        }
        this._ultimo = aviso || null;
        if (typeof this.alCambiar === 'function') { try { this.alCambiar(this._ultimo); } catch (_) { /* */ } }
        if (!aviso || !aviso.activo || !aviso.mensaje) {
            if (opts.forzar && window.Swal) Swal.fire({ icon: 'info', title: 'Sin avisos', text: 'No hay un aviso activo para esta sede.' });
            return;
        }
        if (!opts.forzar) {
            if (esAdmin() && !aviso.paraAdmin) return;
            const v = String(aviso.version);
            if (aviso.mostrar === 'UNA_VEZ' ? lsGet(claveVisto(sede, false)) === v : ssGet(claveVisto(sede, true)) === v) return;
            ssSet(claveVisto(sede, true), v);      // marcado al abrir: no se apila dos veces
            this._abrir(aviso, () => { if (aviso.mostrar === 'UNA_VEZ') lsSet(claveVisto(sede, false), v); });
            return;
        }
        this._abrir(aviso);
    },

    _abrir(aviso, alCerrar) {
        if (!window.Swal) return;
        // No pisar otro cuadro abierto (un cobro, un formulario): esperar a que se cierre
        if (Swal.isVisible()) {
            clearTimeout(this._pendiente);
            this._pendiente = setTimeout(() => this._abrir(aviso, alCerrar), 1500);
            return;
        }
        const t = TIPOS[aviso.tipo] || TIPOS.ADVERTENCIA;
        const mensaje = esc(aviso.mensaje).replace(/\n/g, '<br>');
        Swal.fire({
            html: `
                <div style="text-align:center; font-family:inherit;">
                    <div style="width:84px; height:84px; margin:4px auto 14px; border-radius:50%; background:${t.fondo};
                                display:flex; align-items:center; justify-content:center; box-shadow:0 0 0 10px ${t.fondo}66;">
                        <i class="fas ${t.icono}" style="font-size:2.4rem; color:${t.color};"></i>
                    </div>
                    <div style="display:inline-block; padding:4px 12px; border-radius:999px; background:${t.color}; color:#fff;
                                font-size:.68rem; font-weight:900; letter-spacing:2px; margin-bottom:10px;">AVISO DE LA ADMINISTRACIÓN · ${t.etiqueta}</div>
                    ${aviso.titulo ? `<h2 style="margin:6px 0 10px; font-size:1.35rem; font-weight:900; color:#0f172a; line-height:1.25;">${esc(aviso.titulo)}</h2>` : ''}
                    <div style="font-size:1.05rem; line-height:1.55; color:#1e293b; font-weight:600; background:${t.fondo};
                                border-left:5px solid ${t.color}; border-radius:12px; padding:16px 18px; text-align:left;">${mensaje}</div>
                    <div style="margin-top:12px; font-size:.75rem; color:#64748b; font-weight:600;">
                        — ${esc(aviso.autor || 'Administración')}${aviso.fecha ? ' · ' + esc(fechaCorta(aviso.fecha)) : ''}
                    </div>
                </div>`,
            confirmButtonText: '<i class="fas fa-check"></i> ENTENDIDO',
            confirmButtonColor: t.color,
            allowOutsideClick: aviso.tipo === 'INFO',
            allowEscapeKey: aviso.tipo === 'INFO',
            width: 520,
            customClass: { popup: 'mh-aviso-popup' }
        }).then(() => { if (alCerrar) alCerrar(); });
    },

    /** Editor del aviso (solo SuperAdmin). */
    async editar() {
        if (!esAdmin()) return;
        const sede = sedeActual();
        let actual = null;
        try { const r = await api.get('/config-sede/aviso', { params: { sedeId: sede } }); actual = r.data && r.data.aviso; } catch (_) { actual = null; }
        const a = actual || { activo: true, tipo: 'ADVERTENCIA', mostrar: 'SIEMPRE', titulo: '', mensaje: '', paraAdmin: false };
        const opt = (v, txt, sel) => `<option value="${v}" ${sel === v ? 'selected' : ''}>${txt}</option>`;
        const lbl = 'display:block; text-align:left; font-size:.68rem; font-weight:900; color:#64748b; letter-spacing:1px; text-transform:uppercase; margin:12px 0 5px;';
        const ctl = 'width:100%; box-sizing:border-box; border:1.5px solid #e2e8f0; border-radius:12px; padding:11px 12px; font-size:.95rem; font-family:inherit; color:#0f172a; background:#f8fafc; outline:none;';
        const res = await Swal.fire({
            title: '📢 Aviso al personal',
            width: 560,
            html: `
                <p style="font-size:.85rem; color:#64748b; margin:0 0 6px;">Aparece en pantalla como cuadro de diálogo a quien entre al sistema (escritorio y celular).</p>
                <label style="display:flex; align-items:center; gap:10px; justify-content:flex-start; font-weight:800; color:#0f172a; margin-top:8px;">
                    <input type="checkbox" id="av-activo" ${a.activo ? 'checked' : ''} style="width:20px; height:20px;"> Aviso activo
                </label>
                <label style="${lbl}">Tipo</label>
                <select id="av-tipo" style="${ctl}">
                    ${opt('PROHIBIDO', '⛔ Prohibición', a.tipo)}${opt('ADVERTENCIA', '⚠️ Importante / advertencia', a.tipo)}${opt('INFO', 'ℹ️ Información', a.tipo)}
                </select>
                <label style="${lbl}">Título (opcional)</label>
                <input id="av-titulo" maxlength="80" style="${ctl}" placeholder="Ej: Políticas de caja" value="${esc(a.titulo || '')}">
                <label style="${lbl}">Mensaje</label>
                <textarea id="av-mensaje" maxlength="1000" rows="4" style="${ctl} resize:vertical;" placeholder="Escriba el mensaje para el personal">${esc(a.mensaje || '')}</textarea>
                <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;">
                    ${PLANTILLAS.map((p, i) => `<button type="button" data-plantilla="${i}" style="border:1px solid #e2e8f0; background:#fff; border-radius:999px; padding:6px 10px; font-size:.72rem; font-weight:700; color:#334155; cursor:pointer;">${esc(p.length > 42 ? p.slice(0, 40) + '…' : p)}</button>`).join('')}
                </div>
                <label style="${lbl}">Cuándo mostrarlo</label>
                <select id="av-mostrar" style="${ctl}">
                    ${opt('SIEMPRE', 'Cada vez que alguien entra al sistema', a.mostrar)}${opt('UNA_VEZ', 'Una sola vez por persona', a.mostrar)}
                </select>
                <label style="${lbl}">Para</label>
                <select id="av-alcance" style="${ctl}">
                    <option value="SEDE">Solo esta sede</option><option value="TODAS">Todas las sedes activas</option>
                </select>
                <label style="display:flex; align-items:center; gap:10px; justify-content:flex-start; font-weight:700; color:#334155; margin-top:12px; font-size:.88rem;">
                    <input type="checkbox" id="av-admin" ${a.paraAdmin ? 'checked' : ''} style="width:18px; height:18px;"> Mostrarlo también a los administradores
                </label>`,
            showCancelButton: true,
            showDenyButton: !!(actual && actual.activo),
            confirmButtonText: '<i class="fas fa-bullhorn"></i> PUBLICAR',
            denyButtonText: 'QUITAR AVISO',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#1a365d',
            denyButtonColor: '#e11d48',
            focusConfirm: false,
            didOpen: () => {
                document.querySelectorAll('[data-plantilla]').forEach(b => {
                    b.onclick = () => { document.getElementById('av-mensaje').value = PLANTILLAS[parseInt(b.dataset.plantilla)]; };
                });
            },
            preConfirm: () => {
                const d = {
                    activo: document.getElementById('av-activo').checked,
                    tipo: document.getElementById('av-tipo').value,
                    titulo: document.getElementById('av-titulo').value.trim(),
                    mensaje: document.getElementById('av-mensaje').value.trim(),
                    mostrar: document.getElementById('av-mostrar').value,
                    todas: document.getElementById('av-alcance').value === 'TODAS',
                    paraAdmin: document.getElementById('av-admin').checked
                };
                if (d.activo && d.mensaje.length < 3) { Swal.showValidationMessage('Escriba el mensaje'); return false; }
                return d;
            }
        });
        let datos = null;
        if (res.isConfirmed) datos = res.value;
        else if (res.isDenied) datos = Object.assign({}, a, { activo: false, todas: false });
        if (!datos) return;
        try {
            const r = await api.put('/config-sede/aviso', Object.assign({ sedeId: sede }, datos));
            const n = (r.data && r.data.sedes || []).length;
            if (window.Toast) Toast.fire({ icon: 'success', title: datos.activo ? `Aviso publicado${n > 1 ? ` en ${n} sedes` : ''}` : 'Aviso retirado' });
            if (datos.activo && r.data.aviso) {
                // El aviso que llega por Socket.io a este mismo equipo no se vuelve a abrir
                ssSet(claveVisto(sede, true), String(r.data.aviso.version));
                this.mostrar({ forzar: true, aviso: r.data.aviso });
            }
        } catch (e) {
            Swal.fire('No se pudo guardar', (e.response && e.response.data && e.response.data.error) || e.message, 'error');
        }
    },

    /** Escucha cambios en vivo (Socket.io). Se puede llamar varias veces. */
    escuchar() {
        const s = window.socket;
        if (!s || s._mhAviso) return;
        s._mhAviso = true;
        s.on('aviso_personal', (d) => {
            if (!d || String(d.sedeId) !== String(sedeActual())) return;
            this.mostrar({ aviso: d.aviso, sedeId: d.sedeId });
        });
    }
};

if (typeof window !== 'undefined') window.AvisoPersonal = AvisoPersonal;
module.exports = AvisoPersonal;
