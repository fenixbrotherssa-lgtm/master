const api = require('./api');

const DashboardModule = {
    _clockTimer: null,

    async init() {
        window.DashboardModule = this;
        this._iniciarReloj();
        this._setUserName();
        this._adminOnlyCards();
        this._verificarCaja();
        this._cargarAlertas();
        this._cargarAlertasMantenimiento();
    },

    _iniciarReloj() {
        const tick = () => {
            const el = document.getElementById('dash-live-clock');
            if (!el) { clearInterval(this._clockTimer); this._clockTimer = null; return; }
            el.textContent = new Date().toLocaleTimeString('es-EC');
        };
        tick();
        this._clockTimer = setInterval(tick, 1000);
    },

    _setUserName() {
        const el = document.getElementById('dash-user-name');
        if (el && App.user) {
            const nombre = App.user.NombreFull || App.user.Usuario || 'usuario';
            el.textContent = `Bienvenido, ${nombre}`;
        }
    },

    _adminOnlyCards() {
        const isAdmin = App.user && parseInt(App.user.RolID) === 1;
        document.querySelectorAll('.admin-only').forEach(el => {
            el.style.display = isAdmin ? '' : 'none';
        });
    },

    async _verificarCaja() {
        const user    = App.user;
        const sedeId  = localStorage.getItem('currentSedeId') || user?.SedeID;
        const userId  = user?.UsuarioID || user?.id;
        if (!userId || !sedeId) return;

        try {
            const [resCaja, resRack] = await Promise.all([
                api.get(`/caja/estado/${userId}/${sedeId}`),
                api.get(`/recepcion/rack/${sedeId}`)
            ]);

            const elCaja = document.getElementById('wg-caja');
            if (elCaja) {
                if (resCaja.data.abierta) {
                    elCaja.textContent = 'Abierta ✓';
                    elCaja.style.color = '#27ae60';
                } else {
                    elCaja.textContent = 'Cerrada';
                    elCaja.style.color = '#e74c3c';
                }
            }

            const habitaciones = resRack.data || [];
            if (habitaciones.length > 0) {
                const total   = habitaciones.length;
                const ocupadas = habitaciones.filter(h => h.Estado === 'OCUPADA').length;
                const pct     = Math.round((ocupadas / total) * 100);

                const elOcup = document.getElementById('wg-ocupacion');
                if (elOcup) elOcup.textContent = `${pct}%`;

                const hoyStr = new Date().toISOString().split('T')[0];
                const salidas = habitaciones.filter(h =>
                    h.Estado === 'OCUPADA' && h.FechaSalidaProgramada &&
                    h.FechaSalidaProgramada.slice(0, 10) === hoyStr
                ).length;

                const elSal = document.getElementById('wg-salidas');
                if (elSal) elSal.textContent = salidas;
            }
        } catch (_) {
            const elCaja = document.getElementById('wg-caja');
            if (elCaja) elCaja.textContent = '—';
        }
    },

    async _cargarAlertas() {
        const lista = document.getElementById('dash-alerts-list');
        if (!lista) return;

        try {
            const sedeId = localStorage.getItem('currentSedeId') || App.user?.SedeID;
            const hoy  = new Date().toISOString().split('T')[0];
            const en30 = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

            const res = await api.get(`/reservas/lista/${sedeId}?estado=PENDIENTE&desde=${hoy}&hasta=${en30}`);
            const pendientes = res.data.reservas || [];

            lista.innerHTML = '';

            if (!pendientes.length) {
                lista.innerHTML = `<div style="text-align:center;padding:20px;opacity:.6;font-size:.8rem;">
                    <i class="fas fa-check-circle" style="color:#27ae60"></i> Sin reservas pendientes</div>`;
                return;
            }

            pendientes.forEach(rv => {
                const item = document.createElement('div');
                item.className = 'alert-item warning';
                item.style.cursor = 'pointer';
                item.onclick = () => App.renderView('reservas', 'viewport');
                item.innerHTML = `
                    <i class="fas fa-calendar-check" style="color:#f39c12;font-size:1.2rem"></i>
                    <div>
                        <strong>${rv.NombreReserva}</strong>
                        <div style="font-size:.7rem;color:#718096">
                            Llega ${rv.LlegadaFmt || (rv.FechaLlegada||'').split('T')[0]} · ${rv.TipoNombre || ''} · <code>${rv.CodigoReserva}</code>
                        </div>
                    </div>`;
                lista.appendChild(item);
            });
        } catch (_) {
            const lista2 = document.getElementById('dash-alerts-list');
            if (lista2) lista2.innerHTML = `<div style="text-align:center;padding:20px;opacity:.5;font-size:.8rem;">
                No se pudieron cargar las alertas</div>`;
        }
    },

    async _cargarAlertasMantenimiento() {
        try {
            const sedeId = localStorage.getItem('currentSedeId') || App.user?.SedeID;
            if (!sedeId) return;
            const res = await api.get(`/mantenimiento/stats/${sedeId}`);
            const { Urgentes, Pendientes } = res.data;

            const badge = document.getElementById('dash-mt-badge');
            if (badge && Urgentes > 0) {
                badge.style.display = 'flex';
                badge.textContent   = Urgentes;
            }

            if ((Pendientes || 0) > 0) {
                const lista = document.getElementById('dash-alerts-list');
                if (lista) {
                    const item = document.createElement('div');
                    item.className   = `alert-item ${Urgentes > 0 ? 'danger' : 'warning'}`;
                    item.style.cursor = 'pointer';
                    item.onclick     = () => App.renderView('mantenimiento', 'viewport');
                    item.innerHTML   = `
                        <i class="fas fa-tools" style="color:${Urgentes > 0 ? '#e74c3c' : '#f39c12'};font-size:1.2rem"></i>
                        <div><strong>${Pendientes} orden(es) de mantenimiento pendiente(s)</strong>
                        <div style="font-size:.7rem;color:#718096">${Urgentes > 0 ? Urgentes + ' urgente(s)' : 'Sin urgentes'} · Toca para gestionar</div></div>`;
                    lista.appendChild(item);
                }
            }
        } catch (_) {}
    },

    destroy() {
        if (this._clockTimer) { clearInterval(this._clockTimer); this._clockTimer = null; }
    }
};

module.exports = DashboardModule;
