// desayunos.js — Desayunos del día (2.4.0). Mismo módulo en escritorio (views/desayunos.html) y en el celular
// (views-mobile/desayunos-movil.html): dibuja dentro de #desayunos-root.
// Lista los folios con desayuno de una fecha (quienes durmieron la noche anterior), marca SERVIDO uno por uno o
// todos los pendientes, y anula con motivo (nivel 3). Todo lo valida y audita el servidor (desayunoService).
const api = require('./api');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = n => '$' + Number(n || 0).toFixed(2);
const pad = n => String(n).padStart(2, '0');
const sumarDias = (txt, n) => {
    const [y, m, d] = txt.split('-').map(Number);
    const x = new Date(y, m - 1, d + n);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
const fechaLarga = txt => {
    const [y, m, d] = txt.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' });
};

function usuario() { try { return JSON.parse(localStorage.getItem('user')) || {}; } catch (e) { return {}; } }
function sedeActual() {
    const u = usuario();
    return localStorage.getItem('currentSedeId') || u.SedeID || '';
}
function puede(nivel) {
    const u = usuario();
    if (parseInt(u.RolID || u.rol) === 1) return true;
    return window.Permisos ? window.Permisos.puede('desayunos', nivel) : nivel <= 2;
}
const toast = (icon, title) => (window.Toast ? window.Toast.fire({ icon, title }) : Swal.fire({ icon, title, timer: 1800, showConfirmButton: false }));

const DesayunosModule = {
    fecha: null,
    datos: null,

    async init() {
        window.DesayunosModule = this;
        this.movil = !!window.AppMobile;
        this.fecha = null;
        if (window.socket) {
            window.socket.off('desayuno:cambio');
            window.socket.on('desayuno:cambio', (e) => { if (!e || !e.fecha || e.fecha === this.fecha) this.cargar(); });
        }
        if (!this.movil && window.App && App.renderSedeSelector && document.getElementById('sedeSelectorDesayunos')) {
            App.renderSedeSelector('sedeSelectorDesayunos', () => this.cargar());
        }
        await this.cargar();
    },

    mover(n) { this.fecha = sumarDias(this.fecha, n); this.cargar(); },
    hoy() { this.fecha = this.datos ? this.datos.hoy : null; this.cargar(); },

    async cargar() {
        const root = document.getElementById('desayunos-root');
        if (!root) return;
        try {
            const q = this.fecha ? `?fecha=${this.fecha}` : '';
            const { data } = await api.get(`/desayunos/lista/${sedeActual()}${q}`);
            this.datos = data;
            this.fecha = data.fecha;
            this.render();
        } catch (e) {
            const msg = e.response?.data?.error || 'No se pudo cargar la lista de desayunos.';
            root.innerHTML = `<div style="padding:30px;text-align:center;color:#c05621;font-weight:800;">${esc(msg)}</div>`;
        }
    },

    render() {
        const root = document.getElementById('desayunos-root');
        if (!root || !this.datos) return;
        const d = this.datos, r = d.resumen;
        const esHoy = d.fecha === d.hoy, futuro = d.fecha > d.hoy;
        const pendientes = d.filas.filter(f => !f.Servido);
        const anula = puede(3);
        const chip = (t, v, c) => `<div style="flex:1;min-width:64px;background:#fff;border-radius:14px;padding:10px 4px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.06);">
            <div style="font-size:1.4rem;font-weight:900;color:${c};">${v}</div><div style="font-size:.62rem;font-weight:800;color:#718096;text-transform:uppercase;">${t}</div></div>`;

        const tarjetas = d.filas.map(f => {
            const badge = f.Modo === 'INCLUIDO'
                ? '<span style="background:#b7791f;color:#fff;font-size:.6rem;font-weight:900;padding:3px 8px;border-radius:10px;">INCLUIDO</span>'
                : `<span style="border:1px solid #b7791f;color:#b7791f;font-size:.6rem;font-weight:900;padding:2px 8px;border-radius:10px;">OPCIONAL ${money(f.Precio)} c/u</span>`;
            const estado = f.Servido
                ? `<div style="color:#2f855a;font-weight:900;font-size:.8rem;">✓ SERVIDO ${esc(f.HoraServido || '')} · x${f.PersonasServidas}</div>
                   <div style="font-size:.65rem;color:#718096;">${esc(f.ServidoPor || '')}${Number(f.Cargo) > 0 ? ` · cargo ${money(f.Cargo)}` : ''}${f.SinDescarga ? ' · sin descontar inventario' : ''}</div>
                   ${anula ? `<button class="btn-neo" style="margin-top:6px;font-size:.7rem;color:#c53030;padding:6px 10px;" onclick="DesayunosModule.anular(${f.DesayunoID}, '${esc(f.NroHabitacion)}')">ANULAR</button>` : ''}`
                : futuro ? '<div style="color:#718096;font-weight:800;font-size:.75rem;">PREVISTO</div>'
                : `<button class="btn-neo" style="background:#2f855a;color:#fff;font-weight:900;padding:10px 14px;" onclick="DesayunosModule.servir(${f.RecepcionID})">☕ SERVIR x${f.Personas}</button>`;
            return `<div style="background:#fff;border-radius:16px;padding:14px;box-shadow:0 2px 10px rgba(0,0,0,.07);display:flex;justify-content:space-between;align-items:center;gap:10px;${f.Servido ? 'opacity:.85;' : ''}">
                <div style="min-width:0;">
                    <div style="font-weight:900;color:#1a365d;font-size:1.05rem;">Hab. ${esc(f.NroHabitacion)} ${badge}</div>
                    <div style="font-size:.78rem;color:#4a5568;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(f.Huesped)}</div>
                    <div style="font-size:.66rem;color:#718096;">${f.Personas} persona(s)${f.Producto ? ' · ' + esc(f.Producto) : ' · sin producto'}${f.EnCasa ? ` · sale ${esc(f.SalidaFmt || '')}` : ' · ya salió'}</div>
                </div>
                <div style="text-align:right;flex-shrink:0;">${estado}</div>
            </div>`;
        }).join('');

        root.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
                <button class="btn-neo" style="padding:8px 12px;" onclick="DesayunosModule.mover(-1)">◀</button>
                <div style="flex:1;text-align:center;font-weight:900;color:#1a365d;text-transform:capitalize;min-width:150px;">
                    ${esc(fechaLarga(d.fecha))}${esHoy ? ' <span style="color:#2f855a;">(hoy)</span>' : ''}</div>
                <button class="btn-neo" style="padding:8px 12px;" onclick="DesayunosModule.mover(1)">▶</button>
                ${esHoy ? '' : '<button class="btn-neo" style="padding:8px 12px;" onclick="DesayunosModule.hoy()">HOY</button>'}
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
                ${chip('Personas', r.personas, '#1a365d')}${chip('Servidas', r.personasServidas, '#2f855a')}
                ${chip('Incluidos', r.incluidos, '#b7791f')}${chip('Opcionales', r.opcionales, '#975a16')}
            </div>
            ${pendientes.length > 1 && !futuro ? `<button class="btn-neo" style="width:100%;justify-content:center;margin-bottom:12px;font-weight:900;color:#2f855a;" onclick="DesayunosModule.servirTodos()">☕ SERVIR LOS ${pendientes.length} PENDIENTES</button>` : ''}
            <div style="display:flex;flex-direction:column;gap:10px;">
                ${tarjetas || '<div style="padding:30px;text-align:center;color:#718096;font-weight:700;">No hay huéspedes con desayuno para este día.</div>'}
            </div>`;
    },

    async _enviarServir(recepcionId, extra = {}) {
        return (await api.post('/desayunos/servir', { recepcionId, fecha: this.fecha, sedeId: sedeActual(), origen: this.movil ? 'MOVIL' : 'ESCRITORIO', ...extra })).data;
    },

    // Sin stock: se ofrece registrar sin descontar (con motivo), como en Eventos.
    async _sinStock(recepcionId, msg, personas) {
        const { value: motivo } = await Swal.fire({
            icon: 'warning', title: 'SIN STOCK', text: msg,
            input: 'text', inputPlaceholder: 'Motivo para registrar sin descontar (mín. 10 caracteres)',
            showCancelButton: true, confirmButtonText: 'REGISTRAR SIN DESCONTAR', cancelButtonText: 'CANCELAR',
            inputValidator: v => (!v || v.trim().length < 10) ? 'Escriba el motivo (mínimo 10 caracteres)' : undefined,
        });
        if (!motivo) return null;
        return this._enviarServir(recepcionId, { personas, sinDescarga: true, motivo });
    },

    async servir(recepcionId) {
        const f = this.datos.filas.find(x => x.RecepcionID === recepcionId);
        if (!f) return;
        const { value: personas, isConfirmed } = await Swal.fire({
            title: `Hab. ${f.NroHabitacion}`,
            html: `<div style="font-size:.85rem;">${esc(f.Huesped)}<br>${f.Modo === 'INCLUIDO' ? 'Desayuno incluido' : `Desayuno opcional: ${money(f.Precio)} por persona (se carga al folio)`}</div>`,
            input: 'number', inputValue: f.Personas, inputAttributes: { min: 1, max: f.Personas },
            inputLabel: 'Personas que desayunaron', showCancelButton: true, confirmButtonText: '☕ SERVIDO', cancelButtonText: 'CANCELAR',
            inputValidator: v => (!(parseInt(v) >= 1) || parseInt(v) > f.Personas) ? `Entre 1 y ${f.Personas}` : undefined,
        });
        if (!isConfirmed) return;
        const n = parseInt(personas);
        try {
            const r = await this._enviarServir(recepcionId, { personas: n });
            toast('success', `Hab. ${r.habitacion}: desayuno registrado${r.cargo > 0 ? ` (${money(r.cargo)} al folio)` : ''}`);
        } catch (e) {
            const d = e.response?.data || {};
            if (d.stockInsuficiente) {
                try { const r = await this._sinStock(recepcionId, d.error, n); if (r) toast('success', `Hab. ${r.habitacion}: registrado sin descontar`); }
                catch (x) { Swal.fire({ icon: 'error', title: 'DESAYUNO', text: x.response?.data?.error || 'No se pudo registrar' }); }
            } else Swal.fire({ icon: 'error', title: 'DESAYUNO', text: d.error || 'No se pudo registrar' });
        }
        this.cargar();
    },

    async servirTodos() {
        const pend = this.datos.filas.filter(f => !f.Servido);
        const ok = await Swal.fire({ icon: 'question', title: `¿Servir ${pend.length} desayunos?`,
            text: 'Se registra cada folio con todas sus personas. Los opcionales se cargan a su folio.',
            showCancelButton: true, confirmButtonText: 'SÍ, SERVIR', cancelButtonText: 'CANCELAR' });
        if (!ok.isConfirmed) return;
        const fallos = [];
        for (const f of pend) {
            try { await this._enviarServir(f.RecepcionID); }
            catch (e) { fallos.push(`Hab. ${f.NroHabitacion}: ${e.response?.data?.error || 'error'}`); }
        }
        await this.cargar();
        if (fallos.length) Swal.fire({ icon: 'warning', title: `${pend.length - fallos.length} de ${pend.length} registrados`,
            html: `<div style="text-align:left;font-size:.8rem;">${fallos.map(esc).join('<br>')}</div><div style="font-size:.75rem;margin-top:8px;">Regístrelos uno por uno (sin stock se puede registrar sin descontar, con motivo).</div>` });
        else toast('success', `${pend.length} desayunos registrados`);
    },

    async anular(desayunoId, hab) {
        const { value: motivo } = await Swal.fire({
            icon: 'warning', title: `Anular desayuno · Hab. ${hab}`,
            text: 'Se devuelve al inventario lo que salió y, si era opcional, se quita el cargo del folio. El registro queda como ANULADO.',
            input: 'text', inputPlaceholder: 'Motivo (mínimo 10 caracteres)', showCancelButton: true,
            confirmButtonText: 'ANULAR', cancelButtonText: 'CANCELAR', confirmButtonColor: '#c53030',
            inputValidator: v => (!v || v.trim().length < 10) ? 'Escriba el motivo (mínimo 10 caracteres)' : undefined,
        });
        if (!motivo) return;
        try {
            await api.post(`/desayunos/${desayunoId}/anular`, { motivo, sedeId: sedeActual() });
            toast('success', 'Desayuno anulado');
        } catch (e) { Swal.fire({ icon: 'error', title: 'ANULAR', text: e.response?.data?.error || 'No se pudo anular' }); }
        this.cargar();
    },
};

window.DesayunosModule = DesayunosModule;
module.exports = DesayunosModule;
