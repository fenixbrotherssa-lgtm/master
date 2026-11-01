/* ============================================================================
 *  permisos.js — permisos por módulo del usuario actual (window.Permisos)
 *  Niveles: 0 sin acceso · 1 ver · 2 crear/editar · 3 total. El SuperAdmin tiene todo.
 *  El servidor es quien manda (middlewares/permisosGuard.js); esto solo decide qué
 *  tarjetas y botones se muestran. Mismo archivo en on-premise y SaaS.
 *
 *      await Permisos.cargar();               // al entrar al panel (cachea en memoria y localStorage)
 *      Permisos.puede('eventos', 3)           // síncrono
 *      Permisos.aplicarPanel(contenedor)      // muestra / oculta las tarjetas del panel
 * ========================================================================== */
const api = require('./api');

const NIVEL = { NINGUNO: 0, VER: 1, EDITAR: 2, TOTAL: 3 };
// Vistas que no son módulos con permiso (siempre visibles)
const LIBRES = new Set(['dashboard', 'login']);

function usuario() {
    try { return (window.App && App.user) || JSON.parse(localStorage.getItem('user')); } catch (e) { return null; }
}
function esAdmin() {
    const u = usuario();
    return !!u && (parseInt(u.RolID || u.rol) === 1 || !!u.Soporte);
}
function leerCache() {
    try { return JSON.parse(localStorage.getItem('permisos') || 'null'); } catch (e) { return null; }
}

const Permisos = {
    NIVEL,
    _datos: leerCache(),

    async cargar() {
        if (esAdmin()) return (this._datos = { esAdmin: true, permisos: {} });
        try {
            const { data } = await api.get('/permisos/mios');
            this._datos = data;
            try { localStorage.setItem('permisos', JSON.stringify(data)); } catch (e) { /* sin almacenamiento */ }
        } catch (e) {
            // Servidor anterior a los permisos (404): se conserva el comportamiento de siempre
            if (e.response && e.response.status === 404) this._datos = null;
        }
        return this._datos;
    },

    limpiar() {
        this._datos = null;
        try { localStorage.removeItem('permisos'); } catch (e) { /* nada */ }
    },

    /** Nivel del usuario en un módulo; null si el servidor todavía no tiene permisos. */
    nivel(modulo) {
        if (esAdmin()) return NIVEL.TOTAL;
        if (!this._datos || !this._datos.permisos) return null;
        return this._datos.permisos[modulo] || 0;
    },

    /** ¿Tiene al menos `nivel` en `modulo`? Sin datos del servidor: solo el administrador (como antes). */
    puede(modulo, nivel = NIVEL.VER) {
        const n = this.nivel(modulo);
        if (n === null) return esAdmin();
        return n >= nivel;
    },

    /** ¿La vista es un módulo con permiso y el usuario no lo tiene? */
    vistaBloqueada(vista) {
        if (LIBRES.has(vista) || esAdmin()) return false;
        if (!this._datos || !this._datos.permisos) return false;          // servidor viejo: sin cambios
        if (!(vista in this._datos.permisos)) return false;               // vista sin módulo propio
        return !this.puede(vista, NIVEL.VER);
    },

    /** Muestra cada tarjeta del panel según el permiso de su vista (onclick="App.renderView('x', ...)"). */
    aplicarPanel(raiz) {
        const admin = esAdmin();
        const conDatos = !!(this._datos && this._datos.permisos);
        (raiz || document).querySelectorAll('[onclick*="App.renderView("]').forEach(el => {
            const m = (el.getAttribute('onclick') || '').match(/App\.renderView\(\s*['"]([\w-]+)['"]/);
            if (!m) return;
            const vista = m[1];
            let ver;
            if (admin) ver = true;
            else if (conDatos && vista in this._datos.permisos) ver = this.puede(vista, NIVEL.VER);
            else ver = !el.classList.contains('admin-only');               // sin permisos en el servidor: como antes
            el.style.display = ver ? '' : 'none';
        });
    },
};

window.Permisos = Permisos;
module.exports = Permisos;
