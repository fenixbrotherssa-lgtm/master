// metodosPago.js — window.MetodosPago
// Llena cualquier <select data-metodos-pago> con los métodos de pago ACTIVOS de la
// sede (Configuración de sede → Métodos de pago), con su grupo en data-grupo
// (EFECTIVO / TRANSFERENCIA / TARJETA / DIGITAL).
//
// Igual con <select data-centros-costo>: centros de costo activos de la sede,
// con "— Sin asignar —" como primera opción (valor vacío).
//
// Un MutationObserver detecta los selects apenas aparecen (vistas y modales Swal),
// así ninguna pantalla tiene que llamarlo a mano. Si el servidor no responde, el
// select conserva sus opciones originales (EFECTIVO/TRANSFERENCIA/TARJETA).
const api = require('./api');

const MetodosPago = {
    _cache: {},          // sedeId -> Promise<[{MetodoID, Nombre, Grupo, ComisionPct}]>

    sedeActual() {
        const sel = document.getElementById('globalSedeSelector');
        const user = JSON.parse(localStorage.getItem('user') || 'null');
        return (sel && sel.value) || localStorage.getItem('currentSedeId') || (user && user.SedeID) || '';
    },

    _ultima: null,       // última lista cargada (para consultas síncronas)

    listar(sedeId = this.sedeActual()) {
        if (!this._cache[sedeId]) {
            this._cache[sedeId] = api.get(`/config-sede/metodos-pago?sedeId=${sedeId}`)
                .then(r => Array.isArray(r.data) && r.data.length ? (this._ultima = r.data) : null)
                .catch(() => { delete this._cache[sedeId]; return null; });
        }
        return this._cache[sedeId];
    },

    _cacheCentros: {},   // sedeId -> Promise<[{CentroCostoID, Codigo, Nombre, Tipo}]>

    centros(sedeId = this.sedeActual()) {
        if (!this._cacheCentros[sedeId]) {
            this._cacheCentros[sedeId] = api.get(`/config-sede/centros-lista?sedeId=${sedeId}`)
                .then(r => Array.isArray(r.data) ? r.data : [])
                .catch(() => { delete this._cacheCentros[sedeId]; return []; });
        }
        return this._cacheCentros[sedeId];
    },

    async poblarCentros(select) {
        if (!select || select.dataset.ccListo === '1') return;
        select.dataset.ccListo = '1';
        const previo = select.value || select.dataset.valor || '';
        const lista = await this.centros();
        select.innerHTML = '<option value="">— Sin asignar —</option>' + lista.map(c =>
            `<option value="${c.CentroCostoID}">${c.Codigo} · ${c.Nombre}</option>`).join('');
        if ([...select.options].some(o => o.value === String(previo))) select.value = String(previo);
    },

    invalidar() { this._cache = {}; this._cacheCentros = {}; },

    async poblar(select) {
        if (!select || select.dataset.mpListo === '1') return;
        select.dataset.mpListo = '1';
        const metodos = await this.listar();
        if (!metodos) return; // sin conexión: se quedan las opciones de fábrica
        const previo = select.value;
        select.innerHTML = metodos.map(m =>
            `<option value="${m.MetodoID}" data-grupo="${m.Grupo}">${String(m.Nombre).toUpperCase()}</option>`).join('');
        if ([...select.options].some(o => o.value === previo)) select.value = previo;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    },

    poblarTodos(root = document) {
        root.querySelectorAll('select[data-metodos-pago]').forEach(s => this.poblar(s));
        root.querySelectorAll('select[data-centros-costo]').forEach(s => this.poblarCentros(s));
    },

    // Grupo del método elegido en un select (o por ID si no hay data-grupo).
    grupoDe(select) {
        const opt = select && select.selectedOptions && select.selectedOptions[0];
        if (opt && opt.dataset.grupo) return opt.dataset.grupo;
        return { 1: 'EFECTIVO', 2: 'TRANSFERENCIA', 3: 'TARJETA' }[parseInt(select && select.value)] || 'DIGITAL';
    },

    // ¿El método exige comprobante? Todo lo que no es EFECTIVO (transferencia,
    // tarjeta, billeteras digitales) — antes solo se pedía para los IDs 2 y 3.
    esNoEfectivo(metodoId) {
        const id = parseInt(metodoId);
        const m = (this._ultima || []).find(x => x.MetodoID === id);
        if (m) return m.Grupo !== 'EFECTIVO';
        return id !== 1;
    },

    _observar() {
        if (this._obs || typeof MutationObserver === 'undefined') return;
        this._obs = new MutationObserver(muts => {
            for (const m of muts) for (const n of m.addedNodes) {
                if (n.nodeType !== 1) continue;
                if (n.matches && n.matches('select[data-metodos-pago]')) this.poblar(n);
                else if (n.matches && n.matches('select[data-centros-costo]')) this.poblarCentros(n);
                else if (n.querySelectorAll) this.poblarTodos(n);
            }
        });
        this._obs.observe(document.body, { childList: true, subtree: true });
        this.poblarTodos();
    },
};

window.MetodosPago = MetodosPago;
if (document.body) MetodosPago._observar();
else document.addEventListener('DOMContentLoaded', () => MetodosPago._observar());

module.exports = MetodosPago;
