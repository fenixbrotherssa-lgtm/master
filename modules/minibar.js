const api = require('./api');

const MinibarModule = {
    catalogo: [],
    dotacion: [],        // [{ ProductoID, Nombre, PrecioVenta, Cantidad }]
    habsMinibar: [],      // habitaciones con TieneMinibar
    scope: 'sede',        // 'sede' | <HabitacionID>

    async init() {
        window.MinibarModule = this;
        if (typeof Router !== 'undefined') Router.showBack(false);
        window.backView = 'dashboard';

        App.renderSedeSelector('sedeSelectorMinibar', () => this.recargarTodo());
        await this.recargarTodo();
    },

    getSedeId() {
        const sel = document.getElementById('globalSedeSelector');
        return sel ? sel.value : (localStorage.getItem('currentSedeId') || App.user.SedeID);
    },

    async recargarTodo() {
        this.scope = 'sede';
        await Promise.all([this.cargarCatalogo(), this.cargarHabsMinibar()]);
        this.renderScopeSelector();
        await this.cargarDotacion();
        this.renderCatalogo(document.getElementById('mb-buscar') ? document.getElementById('mb-buscar').value : '');
    },

    async cargarCatalogo() {
        try {
            const r = await api.get(`/inventario/sede/${this.getSedeId()}`);
            this.catalogo = (r.data || []).filter(p => p.Estado !== 0 && p.Estado !== false);
        } catch (e) { this.catalogo = []; }
    },

    async cargarHabsMinibar() {
        try {
            const r = await api.get(`/habitaciones/sede/${this.getSedeId()}`);
            this.habsMinibar = (r.data || []).filter(h => h.TieneMinibar);
        } catch (e) { this.habsMinibar = []; }
    },

    renderScopeSelector() {
        const sel = document.getElementById('mb-scope');
        if (!sel) return;
        const opts = ['<option value="sede">Estándar de la sede (todas las habitaciones)</option>']
            .concat(this.habsMinibar.map(h => `<option value="${h.HabitacionID}">Habitación ${h.NroHabitacion} — personalizada</option>`));
        sel.innerHTML = opts.join('');
        sel.value = String(this.scope);
    },

    cambiarScope(v) {
        this.scope = v;
        this.cargarDotacion();
    },

    async cargarDotacion() {
        const titulo = document.getElementById('mb-titulo-dotacion');
        const btnQuitar = document.getElementById('mb-quitar-override');
        try {
            if (this.scope === 'sede') {
                const r = await api.get(`/minibar/dotacion/${this.getSedeId()}`);
                this.dotacion = (r.data || []).map(d => ({ ProductoID: d.ProductoID, Nombre: d.Nombre, PrecioVenta: d.PrecioVenta, Cantidad: d.Cantidad }));
                if (titulo) titulo.textContent = 'Dotación estándar de la sede';
                if (btnQuitar) btnQuitar.style.display = 'none';
            } else {
                const r = await api.get(`/minibar/dotacion/habitacion/${this.scope}`);
                const data = r.data || {};
                this.dotacion = (data.items || []).map(d => ({ ProductoID: d.ProductoID, Nombre: d.Nombre, PrecioVenta: d.PrecioVenta, Cantidad: d.Cantidad }));
                const hab = this.habsMinibar.find(h => String(h.HabitacionID) === String(this.scope));
                if (titulo) titulo.textContent = `Habitación ${hab ? hab.NroHabitacion : this.scope}` + (data.esOverride ? ' (personalizada)' : ' (usando el estándar)');
                if (btnQuitar) btnQuitar.style.display = data.esOverride ? 'inline-flex' : 'none';
            }
        } catch (e) {
            this.dotacion = [];
        }
        this.renderDotacion();
        this.renderCatalogo(document.getElementById('mb-buscar') ? document.getElementById('mb-buscar').value : '');
    },

    renderCatalogo(filtro = '') {
        const cont = document.getElementById('mb-catalogo');
        if (!cont) return;
        const f = (filtro || '').toLowerCase();
        const rows = this.catalogo.filter(p => !f || (p.Nombre || '').toLowerCase().includes(f));
        if (rows.length === 0) { cont.innerHTML = '<div class="mb-empty">Sin productos.</div>'; return; }
        cont.innerHTML = rows.map(p => {
            const yaEsta = this.dotacion.some(d => d.ProductoID === p.ProductoID);
            return `
            <div class="mb-row">
                <div>
                    <div class="n">${p.Nombre}</div>
                    <div class="m">$${parseFloat(p.PrecioVenta).toFixed(2)} · stock ${p.StockActual}</div>
                </div>
                <button class="mb-btn" style="padding:6px 12px; ${yaEsta ? 'opacity:.4; pointer-events:none;' : ''}" onclick="MinibarModule.agregar(${p.ProductoID})">
                    <i class="fas fa-${yaEsta ? 'check' : 'plus'}"></i>
                </button>
            </div>`;
        }).join('');
    },

    renderDotacion() {
        const cont = document.getElementById('mb-dotacion');
        if (!cont) return;
        if (this.dotacion.length === 0) {
            cont.innerHTML = '<div class="mb-empty">Sin productos en la dotación.<br>Agrégalos desde el inventario de la izquierda.</div>';
            return;
        }
        cont.innerHTML = this.dotacion.map(d => `
            <div class="mb-row">
                <div class="n" style="flex:1;">${d.Nombre}</div>
                <input type="number" class="qty" min="1" step="1" value="${d.Cantidad}" onchange="MinibarModule.setCant(${d.ProductoID}, this.value)">
                <button class="mb-btn danger" style="padding:6px 10px;" onclick="MinibarModule.quitar(${d.ProductoID})"><i class="fas fa-trash-alt"></i></button>
            </div>`).join('');
    },

    agregar(pid) {
        if (this.dotacion.some(d => d.ProductoID === pid)) return;
        const p = this.catalogo.find(x => x.ProductoID === pid);
        if (!p) return;
        this.dotacion.push({ ProductoID: pid, Nombre: p.Nombre, PrecioVenta: p.PrecioVenta, Cantidad: 1 });
        this.renderDotacion();
        this.renderCatalogo(document.getElementById('mb-buscar').value);
    },

    quitar(pid) {
        this.dotacion = this.dotacion.filter(d => d.ProductoID !== pid);
        this.renderDotacion();
        this.renderCatalogo(document.getElementById('mb-buscar').value);
    },

    setCant(pid, val) {
        let c = parseInt(val, 10);
        if (isNaN(c) || c < 1) c = 1;
        const d = this.dotacion.find(x => x.ProductoID === pid);
        if (d) d.Cantidad = c;
    },

    async guardar() {
        try {
            await api.post('/minibar/dotacion', {
                SedeID: parseInt(this.getSedeId()),
                HabitacionID: this.scope === 'sede' ? null : parseInt(this.scope),
                items: this.dotacion.map(d => ({ ProductoID: d.ProductoID, Cantidad: d.Cantidad }))
            });
            window.Toast.fire({ icon: 'success', title: 'Dotación guardada', timer: 1400, showConfirmButton: false });
            await this.cargarHabsMinibar();
            this.renderScopeSelector();
            await this.cargarDotacion();
        } catch (err) {
            window.Toast.fire({ icon: 'error', title: (err.response && err.response.data && err.response.data.error) || 'Error al guardar' });
        }
    },

    async quitarOverride() {
        if (this.scope === 'sede') return;
        const hab = this.habsMinibar.find(h => String(h.HabitacionID) === String(this.scope));
        const r = await Swal.fire({
            title: `¿Quitar personalización de la Hab. ${hab ? hab.NroHabitacion : this.scope}?`,
            text: 'Volverá a usar la dotación estándar de la sede.',
            icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí, quitar', cancelButtonText: 'Cancelar'
        });
        if (!r.isConfirmed) return;
        try {
            await api.delete(`/minibar/dotacion/habitacion/${this.scope}`);
            window.Toast.fire({ icon: 'success', title: 'Personalización quitada', timer: 1400, showConfirmButton: false });
            await this.cargarDotacion();
        } catch (err) {
            window.Toast.fire({ icon: 'error', title: 'Error al quitar' });
        }
    }
};

module.exports = MinibarModule;
