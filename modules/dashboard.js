const api = require('./api');

const DashboardModule = {
    _clockTimer: null,

    async init() {
        window.DashboardModule = this;
        this._iniciarReloj();
        this._setUserName();
        this._adminOnlyCards();
        this._avisosSistema();
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

    // Tarjetas según los permisos del usuario (roles): primero con lo guardado, luego con lo del servidor.
    _adminOnlyCards() {
        const Permisos = require('./permisos');
        const panel = document.getElementById('viewport') || document;
        Permisos.aplicarPanel(panel);
        Permisos.cargar().then(() => Permisos.aplicarPanel(panel)).catch(() => {});
    },

    // Avisos del sistema (solo on-premise; en SaaS no existen estas rutas y no se muestra nada):
    //  - administrador: la licencia del servidor no está registrada o no es válida;
    //  - cualquier usuario del escritorio Windows: el servidor ya está en una versión más nueva que este equipo.
    async _avisosSistema() {
        const panel = document.querySelector('#viewport .neo-card')?.parentElement;
        if (!panel || document.getElementById('aviso-sistema')) return;
        const avisos = [];
        try {
            if (App.user && parseInt(App.user.RolID) === 1) {
                const { data: l } = await api.get('/licencia/estado');
                if (l && l.modo && l.modo !== 'ACTIVA')
                    avisos.push(`<span><i class="fas fa-id-card"></i> ${l.modo === 'SIN_CLAVE' ? 'Registre la licencia de este servidor para recibir actualizaciones y soporte.' : 'La licencia de este servidor requiere atención.'}</span>
                                 <button onclick="App.renderView('licencia','viewport')">VER LICENCIA</button>`);
                else if (l && l.modo === 'ACTIVA' && !l.mantenimientoVigente)
                    avisos.push(`<span><i class="fas fa-id-card"></i> El mantenimiento de la licencia venció: renuévelo para seguir recibiendo actualizaciones.</span>
                                 <button onclick="App.renderView('licencia','viewport')">VER LICENCIA</button>`);
            }
        } catch (e) { /* SaaS o servidor anterior: sin aviso */ }
        try {
            const { ipcRenderer } = require('electron');
            if (process.platform === 'win32') {
                const [local, { data: srv }] = await Promise.all([ipcRenderer.invoke('mh:version'), api.get('/actualizaciones/version')]);
                const mayor = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
                if (srv && srv.version && mayor(srv.version, local)) {
                    window._versionServidor = srv.version;
                    avisos.push(`<span><i class="fas fa-cloud-arrow-down"></i> El sistema del hotel ya está en la versión <b>${srv.version}</b>; este equipo tiene la ${local}.</span>
                                 <button onclick="DashboardModule.actualizarEscritorio()">ACTUALIZAR ESTE EQUIPO</button>`);
                }
            }
        } catch (e) { /* sin Electron (móvil) o servidor anterior */ }
        if (!avisos.length) return;
        const div = document.createElement('div');
        div.id = 'aviso-sistema';
        div.innerHTML = `<style>#aviso-sistema{grid-column:1/-1;display:flex;flex-direction:column;gap:8px;margin-bottom:6px}
            #aviso-sistema>div{display:flex;justify-content:space-between;align-items:center;gap:14px;background:#fffbea;border:1px solid #f6e05e;border-radius:14px;padding:12px 16px;color:#744210;font-weight:700;font-size:.85rem}
            #aviso-sistema button{border:none;border-radius:10px;padding:8px 14px;background:#1a365d;color:#fff;font-weight:900;font-size:.72rem;cursor:pointer;white-space:nowrap}</style>`
            + avisos.map(a => `<div>${a}</div>`).join('');
        panel.parentElement.insertBefore(div, panel);
    },

    async actualizarEscritorio() {
        const v = window._versionServidor;
        const ok = await Swal.fire({ icon: 'question', title: `¿Actualizar este equipo a ${v}?`, showCancelButton: true, confirmButtonText: 'Actualizar',
            text: 'MasterHotel se cerrará, se instalará la versión nueva y se volverá a abrir solo. Windows puede pedir permiso para instalar.' });
        if (!ok.isConfirmed) return;
        Swal.fire({ title: 'Descargando...', text: 'Puede tardar un par de minutos.', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        try {
            await require('electron').ipcRenderer.invoke('mh:actualizar-escritorio', v);
            Swal.fire({ title: 'Instalando...', text: 'MasterHotel se volverá a abrir en unos segundos.', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        } catch (e) {
            Swal.fire('No se actualizó', String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
        }
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
