// servidor.js — Servidor del sistema elegido desde el LOGIN (escritorio). window.Servidor
// -----------------------------------------------------------------------------------------------
// Se configura UNA vez con el engranaje del login (o solo, si al abrir no se encuentra el servidor) y
// main.js lo guarda en la carpeta de datos del equipo (userData/servidor.json): sobrevive a las
// actualizaciones y no necesita permisos de administrador. Antes había que editar resources/config.js.
// Mismo archivo en on-premise y SaaS. En el celular no existe: allá manda index-mobile.html.
// -----------------------------------------------------------------------------------------------
(function () {
    let ipc = null;
    try { ipc = require('electron').ipcRenderer; } catch (_) { ipc = null; }

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const anfitrion = (apiUrl) => { try { const u = new URL(apiUrl); return u.host + (u.pathname.replace(/\/api\/?$/, '') || ''); } catch (_) { return apiUrl || ''; } };

    // ¿Responde un servidor MasterHotel en esa URL? /api/salud (2.1.3+ y SaaS); si no existe (versiones
    // viejas), un POST vacío al login debe responder JSON del sistema (400/401), no la página de otro servidor.
    async function probar(apiUrl) {
        const conTope = (url, opc, ms) => {
            const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
            return fetch(url, Object.assign({ signal: ctl.signal, cache: 'no-store' }, opc)).finally(() => clearTimeout(t));
        };
        try {
            const r = await conTope(apiUrl + '/salud', {}, 7000);
            if (r.ok) {
                const j = await r.json().catch(() => null);
                if (j && j.ok !== undefined) return { ok: true, version: j.version || '', bd: j.db !== false };
            }
            const r2 = await conTope(apiUrl + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 7000);
            const j2 = await r2.json().catch(() => null);
            if (j2 && (j2.message || j2.error)) return { ok: true, version: '', bd: true };
            return { ok: false, motivo: 'Responde, pero no es un servidor de MasterHotel (' + r.status + ').' };
        } catch (e) {
            return { ok: false, motivo: e && e.name === 'AbortError' ? 'No respondió a tiempo.' : 'No hay conexión con esa dirección.' };
        }
    }

    const Servidor = {
        disponible: () => !!ipc,
        estado: () => ipc ? ipc.invoke('mh:servidor') : Promise.resolve(null),
        probar,

        // Muestra en el login a qué servidor está enlazado el equipo + el engranaje para cambiarlo.
        async pintarEnLogin(contenedor) {
            if (!ipc || !contenedor) return;
            const st = await this.estado().catch(() => null);
            if (!st) return;
            contenedor.innerHTML = `
                <button type="button" id="btn-login-servidor" title="Servidor del sistema"
                    style="background:#e0e5ea; color:#4a5568; border:none; padding:10px 14px; border-radius:15px; cursor:pointer;
                    font-size:.78rem; font-weight:800; box-shadow: 6px 6px 12px #9eaab6, -6px -6px 12px #ffffff; display:flex; align-items:center; gap:8px; max-width:340px;">
                    <i class="fas fa-server"></i>
                    <span data-no-traducir style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(anfitrion(st.apiUrl))}</span>
                    <i class="fas fa-cog" style="opacity:.6"></i>
                </button>`;
            const b = document.getElementById('btn-login-servidor');
            if (b) b.onclick = () => this.configurar();
        },

        // Al abrir el login: si el equipo nunca eligió servidor y el de fábrica no responde, pide la dirección.
        async revisarAlInicio() {
            if (!ipc) return;
            const st = await this.estado().catch(() => null);
            if (!st || st.guardado || st.desarrollo) return;
            const p = await probar(st.apiUrl);
            if (p.ok) return;
            if (Swal.isVisible()) return;
            this.configurar({ aviso: `No se encontró el servidor en <b>${esc(anfitrion(st.apiUrl))}</b> (${esc(p.motivo.replace(/\.$/, ''))}).<br>Escriba la dirección del servidor del sistema.` });
        },

        async configurar(opc = {}) {
            if (!ipc) return;
            const st = await this.estado();
            let forzar = false;                       // segundo clic tras un fallo = guardar de todos modos
            let ultimaDir = '';
            const r = await Swal.fire({
                title: 'Servidor del sistema',
                html: `
                    ${opc.aviso ? `<div style="background:#fff5f5; color:#9b2c2c; border-radius:12px; padding:10px 12px; font-size:.85rem; margin-bottom:12px;">${opc.aviso}</div>` : ''}
                    <div style="font-size:.85rem; color:#4a5568; text-align:left; line-height:1.5;">
                        Este equipo se conecta a: <b data-no-traducir>${esc(anfitrion(st.apiUrl))}</b>
                        ${st.guardado ? '<br><span style="color:#718096">(elegido en este equipo)</span>' : '<br><span style="color:#718096">(dirección de fábrica)</span>'}
                    </div>
                    <input id="mh-srv-dir" class="swal2-input" placeholder="Ej.: 192.168.1.10   ·   192.168.1.10:4000   ·   hotel.midominio.com"
                        value="${esc(st.guardado || '')}" autocomplete="off" spellcheck="false" style="margin:14px 0 6px; width:100%; box-sizing:border-box;">
                    <div id="mh-srv-url" data-no-traducir style="font-size:.75rem; color:#718096; min-height:18px; text-align:left;"></div>
                    <div style="font-size:.75rem; color:#a0aec0; text-align:left; margin-top:8px;">
                        IP de la red del hotel → se usa el puerto ${esc((st.porDefecto.match(/:(\d+)\/api$/) || [])[1] || '4000')} si no escribe otro. Dominio → https.
                    </div>
                    ${st.desarrollo ? '<div style="font-size:.75rem; color:#c05621; margin-top:8px;">Desarrollo: una variable de entorno fija el servidor; lo guardado se usará sin ella.</div>' : ''}`,
                showCancelButton: true,
                showDenyButton: !!st.guardado,
                confirmButtonText: '<i class="fas fa-plug"></i> PROBAR Y GUARDAR',
                denyButtonText: 'Usar la de fábrica',
                cancelButtonText: 'Cancelar',
                allowOutsideClick: false,
                didOpen: () => {
                    const inp = document.getElementById('mh-srv-dir');
                    const out = document.getElementById('mh-srv-url');
                    const ver = async () => {
                        forzar = false;
                        Swal.getConfirmButton().innerHTML = '<i class="fas fa-plug"></i> PROBAR Y GUARDAR';
                        Swal.resetValidationMessage();
                        const v = inp.value.trim();
                        if (!v) { out.textContent = ''; return; }
                        try { out.textContent = '→ ' + await ipc.invoke('mh:servidor-normalizar', v); }
                        catch (e) { out.textContent = ''; }
                    };
                    inp.addEventListener('input', ver);
                    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); Swal.clickConfirm(); } });
                    ver(); inp.focus(); inp.select();
                },
                preConfirm: async () => {
                    const dir = document.getElementById('mh-srv-dir').value.trim();
                    let apiUrl;
                    try { apiUrl = await ipc.invoke('mh:servidor-normalizar', dir); }
                    catch (e) { Swal.showValidationMessage(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); return false; }
                    if (forzar && dir === ultimaDir) return { dir, apiUrl, probado: false };
                    Swal.getConfirmButton().innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> PROBANDO...';
                    const p = await probar(apiUrl);
                    if (p.ok) return { dir, apiUrl, probado: true, version: p.version, bd: p.bd };
                    forzar = true; ultimaDir = dir;
                    Swal.getConfirmButton().innerHTML = 'GUARDAR DE TODOS MODOS';
                    Swal.showValidationMessage(`${p.motivo} Revise la dirección, o guárdela de todos modos si el servidor está apagado.`);
                    return false;
                }
            });

            if (r.isDenied) {
                await ipc.invoke('mh:servidor-guardar', null);
                return this._aplicar('Se volvió a la dirección de fábrica.');
            }
            if (!r.isConfirmed || !r.value) return;
            await ipc.invoke('mh:servidor-guardar', r.value.dir);
            const extra = r.value.probado
                ? (r.value.version ? `Servidor versión ${r.value.version}.` : 'El servidor respondió.') + (r.value.bd === false ? ' ⚠ Sin conexión a la base de datos.' : '')
                : 'Guardado sin probar.';
            return this._aplicar(`Servidor guardado en este equipo. ${extra}`);
        },

        // La sesión era del servidor anterior: se borra y la app se recarga ya apuntando al nuevo.
        async _aplicar(texto) {
            ['token', 'refreshToken', 'user', 'permisos', 'currentSedeId', 'hotel'].forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
            await Swal.fire({ icon: 'success', title: 'Listo', text: texto, timer: 1800, showConfirmButton: false });
            location.reload();
        }
    };

    window.Servidor = Servidor;
})();
