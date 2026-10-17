const api = require('./api');
const pt  = require('./printTicket');

// Registro de aperturas: textos compartidos por la tabla y el reporte impreso
const ETIQUETA_EVENTO = {
    APERTURA_TECLADO: '🔓 Abrió con código', APERTURA_MANUAL: '🔓 Abrió por dentro',
    APERTURA_REMOTA: '🔓 Abierta desde el sistema', BLOQUEO_TECLADO: '🔒 Cerró (teclado)',
    BLOQUEO_MANUAL: '🔒 Cerró por dentro', BLOQUEO_REMOTO: '🔒 Cerrada desde el sistema',
    BLOQUEO_AUTOMATICO: '🔒 Cierre automático', ATASCADA: '⚠️ Cerrojo atascado',
    TECLADO_BLOQUEADO: '⛔ Teclado bloqueado (intentos fallidos)', CODIGO_INVALIDO: '⛔ Código incorrecto',
    MANIPULACION: '🚨 Manipulación de la cerradura'
};
const EVENTOS_ALERTA = ['CODIGO_INVALIDO', 'TECLADO_BLOQUEADO', 'MANIPULACION'];
// Apertura por teclado SIN número de usuario: la cerradura no dijo qué slot abrió →
// un código que el sistema no cargó (programado a mano en la cerradura o de fábrica)
const codigoDesconocido = e => e.Tipo === 'APERTURA_TECLADO' && !e.Slot;
const esAlerta = e => EVENTOS_ALERTA.includes(e.Tipo) || codigoDesconocido(e);
const quienEvento = e => codigoDesconocido(e) ? '❓ Código no registrado en el sistema'
                       : e.TipoCodigo === 'MAESTRO' ? `👑 ${e.Nombre}`
                       : e.TipoCodigo === 'PERSONAL' ? `🛠️ ${e.Nombre}`
                       : e.TipoCodigo === 'HUESPED' ? '🛏️ Huésped' : '—';
const duracionTxt = s => {
    if (s == null) return '';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), seg = s % 60;
    return h ? `${h} h ${m} min` : m ? `${m} min ${seg} s` : `${seg} s`;
};

const CerradurasModule = {
    _tab:         'monitor',
    _pollTimer:   null,
    _countTimer:  null,
    _pollInc:     null,
    _lrTimer:     null,
    _lrVinculadas: new Set(),
    _ctrlActivo:  null,
    _sedeId:      null,

    async init() {
        window.CerradurasModule = this;
        const user = App.user;
        if (user?.RolID !== 1) {
            document.querySelector('.modulo-container').innerHTML =
                '<p style="color:#e74c3c;padding:30px">Acceso restringido a administradores.</p>';
            return;
        }
        this._sedeId = localStorage.getItem('currentSedeId') || user?.SedeID || null;
        await this.cargarMonitor();
        this._pollTimer = setInterval(() => this.refrescarEstados(), 30000);

        // Tiempo real: cada apertura/cierre/código incorrecto y cada caída o
        // reconexión del stick refresca la pestaña abierta. Debounce porque la
        // cerradura suele mandar varios eventos seguidos (abrir + cerrar).
        if (window.socket) {
            const refrescar = () => {
                clearTimeout(this._sockTimer);
                this._sockTimer = setTimeout(() => {
                    if (!document.getElementById('lock-grid')) return;   // ya salió del módulo
                    if (this._tab === 'registro')           this.cargarRegistro();
                    else if (this._tab === 'controladores') this.cargarControladores();
                    else if (this._tab === 'monitor' || !this._tab) this.cargarMonitor();
                }, 500);
            };
            window.socket.on('cerradura:evento', refrescar);
            window.socket.on('cerradura:controlador', refrescar);
        }
    },

    switchTab(tab) {
        this._tab = tab;
        ['monitor','controladores','vincular','codigos','registro'].forEach(t => {
            document.getElementById(`panel-${t}`).style.display   = t === tab ? '' : 'none';
            document.getElementById(`tab-${t}`).classList.toggle('activo', t === tab);
        });
        if (tab === 'controladores') this.cargarControladores();
        if (tab === 'vincular')      this._cargarSelectores().then(() => this.cargarLongRange());
        if (tab === 'codigos')       this.cargarCodigos();
        if (tab === 'registro')      this._iniciarRegistro();
        // Mientras la pestaña Vincular está abierta se refresca el estado de las
        // cerraduras Long Range registradas (se unen solas, en cualquier momento)
        if (this._lrTimer) { clearInterval(this._lrTimer); this._lrTimer = null; }
        if (tab === 'vincular') this._lrTimer = setInterval(() => this.cargarLongRange(), 5000);
    },

    // ── Monitor ───────────────────────────────────────────────────────
    async cargarMonitor() {
        const grid = document.getElementById('lock-grid');
        if (!grid) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
            return;
        }
        try {
            const res = await api.get(`/cerraduras/estado-sede?sedeId=${this._sedeId || ''}`);
            this._renderMonitor(res.data.cerraduras || []);
        } catch (_) {
            const g = document.getElementById('lock-grid');
            if (g) g.innerHTML = '<p style="color:#e74c3c;padding:10px">Error cargando cerraduras.</p>';
        }
    },

    _renderMonitor(cerraduras) {
        const grid = document.getElementById('lock-grid');
        if (!grid) return;
        if (!cerraduras.length) {
            grid.innerHTML = `<p style="color:#718096;font-size:.85rem;padding:10px">
                No hay cerraduras vinculadas.<br>
                Ve a <strong>Vincular Cerradura</strong> para agregar la primera.
            </p>`;
            return;
        }
        grid.innerHTML = cerraduras.map(c => {
            const cls    = c.online ? (c.bloqueada ? 'bloqueada' : 'desbloqueada') : 'offline';
            const stCls  = c.online ? (c.bloqueada ? 'status-bloqueada' : 'status-desbloqueada') : 'status-offline';
            const stTxt  = c.online ? (c.bloqueada ? 'Bloqueada' : 'Abierta') : 'Sin señal';
            const batPct = c.bateria ?? c.BateriaPct ?? null;
            const batBar = batPct !== null
                ? `<div class="bat-bar">
                       <div class="bat-fill ${batPct < 20 ? 'low' : ''}" style="width:${batPct}%"></div>
                   </div>
                   <div style="font-size:.7rem;color:#718096;margin-top:3px">Batería ${batPct}%</div>`
                : '';
            return `
            <div class="lock-card ${cls}">
                <div class="lock-hab">Hab. ${c.NroHabitacion}</div>
                <div class="lock-modelo">${c.Modelo || 'Z-Wave Lock'} · Node ${c.NodeId}</div>
                <span class="lock-status ${stCls}">${stTxt}</span>
                ${batBar}
                <div class="lock-actions">
                    <button class="btn-neo btn-sm" title="Bloquear"
                            onclick="CerradurasModule.toggleLock(${c.CerraduraID}, true)">
                        <i class="fas fa-lock"></i>
                    </button>
                    <button class="btn-neo btn-sm" title="Desbloquear"
                            onclick="CerradurasModule.toggleLock(${c.CerraduraID}, false)">
                        <i class="fas fa-lock-open"></i>
                    </button>
                    <button class="btn-neo btn-sm btn-danger" title="Desvincular"
                            onclick="CerradurasModule.desvincularCerradura(${c.CerraduraID}, ${c.ControladorID}, '${c.NroHabitacion}')">
                        <i class="fas fa-unlink"></i>
                    </button>
                </div>
            </div>`;
        }).join('');
    },

    async refrescarEstados() {
        if (this._tab === 'monitor') await this.cargarMonitor();
    },

    async toggleLock(id, bloquear) {
        try {
            await api.post(`/cerraduras/${id}/${bloquear ? 'bloquear' : 'desbloquear'}`);
            await this.cargarMonitor();
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: e.response?.data?.error || e.message,
                confirmButtonColor: '#1a365d' });
        }
    },

    // ── Controladores ────────────────────────────────────────────────
    async cargarControladores() {
        try {
            const res = await api.get(`/cerraduras/controladores?sedeId=${this._sedeId || ''}`);
            this._controladores = res.data.controladores || [];
            this._renderControladores(this._controladores);
        } catch (_) {}
    },

    _renderControladores(ctls) {
        const grid = document.getElementById('ctrl-grid');
        if (!ctls.length) {
            grid.innerHTML = `<p style="color:#718096;font-size:.85rem;padding:10px">
                No hay controladores registrados. Agrega el USB Z-Wave stick con el botón superior.
            </p>`;
            return;
        }
        grid.innerHTML = ctls.map(c => `
            <div class="ctrl-card">
                <div class="ctrl-card-header">
                    <h4><i class="fas fa-usb" style="color:#c5a059"></i> ${c.Descripcion || c.Puerto}</h4>
                    <span class="led ${c.estadoServicio?.conectado ? 'led-on' : 'led-off'}"
                          title="${c.estadoServicio?.conectado ? 'Conectado' : 'Desconectado'}"></span>
                </div>
                ${c.estadoServicio?.reconectando ? `
                <div class="ctrl-meta" style="color:#c05621;font-weight:600">
                    <i class="fas fa-sync-alt fa-spin"></i> Stick desconectado — reconectando (intento ${c.estadoServicio.intentos}).
                    Revisa el cable USB; los códigos pendientes se cargan solos al volver.
                </div>` : ''}
                <div class="ctrl-meta"><i class="fas fa-plug"></i> Puerto: <strong>${c.Puerto}</strong></div>
                <div class="ctrl-meta"><i class="fas fa-hotel"></i> Sede: ${c.NombreSede}</div>
                <div class="ctrl-meta"><i class="fas fa-lock"></i> Cerraduras: ${c.TotalCerraduras}</div>
                <div class="ctrl-meta"><i class="fas fa-wifi"></i> Nodos Z-Wave: ${c.estadoServicio?.nodos ?? '—'}</div>
                <div class="ctrl-actions">
                    <button class="btn-neo btn-sm" title="Cambiar el puerto COM (Windows renumeró el stick o se volvió a poner otro)"
                            onclick="CerradurasModule.cambiarPuerto(${c.ControladorID}, '${c.Puerto}')">
                        <i class="fas fa-plug"></i> Puerto
                    </button>
                    <button class="btn-neo btn-sm" title="Respaldo de la memoria del stick (para clonarlo en un stick de repuesto)"
                            onclick="CerradurasModule.abrirRespaldos(${c.ControladorID})">
                        <i class="fas fa-shield-alt"></i> Respaldos
                    </button>
                    <button class="btn-neo btn-sm" title="Excluir dispositivo (borra el emparejamiento en el stick y en la cerradura)"
                            onclick="CerradurasModule.excluirDispositivo(${c.ControladorID})">
                        <i class="fas fa-unlink"></i> Excluir dispositivo
                    </button>
                    <button class="btn-neo btn-sm btn-danger"
                            onclick="CerradurasModule.eliminarControlador(${c.ControladorID}, '${c.Puerto}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    },

    async abrirWizardControlador() {
        // El backend escanea los puertos COM y pregunta a cada uno si es un
        // controlador Z-Wave — el usuario solo elige entre los que respondieron.
        Swal.fire({
            title: 'Buscando sticks Z-Wave...',
            text: 'Revisando los puertos USB del servidor',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });
        let sticks = [];
        try {
            const res = await api.get('/cerraduras/controladores/detectar');
            sticks = res.data.sticks || [];
        } catch (e) {
            return Swal.fire({ icon: 'error', title: 'Error al buscar',
                text: e.response?.data?.error || e.message, confirmButtonColor: '#1a365d' });
        }

        const libres = sticks.filter(s => !s.enUso);
        if (!libres.length) {
            return Swal.fire({
                icon: 'info',
                title: 'No se detectó ningún stick nuevo',
                html: sticks.length
                    ? `Los sticks conectados ya están registrados (${sticks.map(s => s.puerto).join(', ')}).`
                    : `No hay ningún controlador Z-Wave conectado al servidor.<br><br>
                       <small style="color:#718096">Verifica que el stick esté enchufado y que Windows
                       tenga instalado su driver (Administrador de dispositivos → Puertos COM).</small>`,
                confirmButtonColor: '#1a365d'
            });
        }

        const { value: datos } = await Swal.fire({
            title: 'Agregar Controlador Z-Wave',
            html: `
                <div style="text-align:left;margin-bottom:10px">
                    <label style="font-size:.78rem;font-weight:700;color:#718096">STICK DETECTADO</label>
                    <select id="sw-puerto" class="swal2-select" style="width:100%;margin:6px 0 0;font-size:.95rem">
                        ${libres.map(s => `<option value="${s.puerto}">${s.puerto} — ${s.version}${s.fabricante ? ` (${s.fabricante})` : ''}</option>`).join('')}
                    </select>
                </div>
                <div style="text-align:left">
                    <label style="font-size:.78rem;font-weight:700;color:#718096">DESCRIPCIÓN (opcional)</label>
                    <input id="sw-desc" class="swal2-input" placeholder="Edificio principal">
                </div>`,
            confirmButtonText:  'Agregar',
            confirmButtonColor: '#1a365d',
            cancelButtonText:   'Cancelar',
            showCancelButton:   true,
            preConfirm: () => ({
                puerto:      document.getElementById('sw-puerto').value,
                descripcion: document.getElementById('sw-desc').value.trim()
            })
        });
        if (!datos?.puerto) return;
        try {
            await api.post('/cerraduras/controladores', {
                sedeId: this._sedeId, ...datos
            });
            Swal.fire({ icon: 'success', title: 'Controlador agregado',
                text: 'Conectando con el stick...', timer: 2000, showConfirmButton: false });
            this.cargarControladores();
            // zwave-js tarda unos segundos en inicializar el stick; refresca para ver el LED en verde
            setTimeout(() => this.cargarControladores(), 8000);
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: e.response?.data?.error || e.message,
                confirmButtonColor: '#1a365d' });
        }
    },

    async eliminarControlador(id, puerto) {
        const conf = await Swal.fire({
            icon: 'warning', title: `¿Eliminar ${puerto}?`,
            text: 'Debes desvincular todas las cerraduras antes.',
            showCancelButton: true, confirmButtonColor: '#e74c3c', confirmButtonText: 'Eliminar'
        });
        if (!conf.isConfirmed) return;
        try {
            await api.delete(`/cerraduras/controladores/${id}`);
            this.cargarControladores();
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: e.response?.data?.error || e.message,
                confirmButtonColor: '#1a365d' });
        }
    },

    // ── Exclusión / desvinculación ───────────────────────────────────
    async desvincularCerradura(cerraduraID, controladorID, nroHab) {
        const r = await Swal.fire({
            icon: 'warning',
            title: `Desvincular cerradura Hab. ${nroHab}`,
            html: `Para borrarla de verdad hay que <b>excluirla</b>: el stick entra en modo
                   exclusión y haces en la cerradura la misma secuencia que al vincularla.<br><br>
                   <small style="color:#718096">"Solo del sistema" es para una cerradura dañada o
                   perdida: la quita de la lista pero sigue emparejada con el stick.</small>`,
            showDenyButton:     true,
            showCancelButton:   true,
            confirmButtonText:  'Excluir (recomendado)',
            denyButtonText:     'Solo del sistema',
            cancelButtonText:   'Cancelar',
            confirmButtonColor: '#1a365d',
            denyButtonColor:    '#e74c3c'
        });
        if (r.isConfirmed) return this.excluirDispositivo(controladorID);
        if (r.isDenied) {
            try {
                await api.delete(`/cerraduras/${cerraduraID}`);
                this.cargarMonitor();
            } catch (e) {
                Swal.fire({ icon: 'error', title: 'Error', text: e.response?.data?.error || e.message,
                    confirmButtonColor: '#1a365d' });
            }
        }
    },

    // ── Respaldo de la memoria (NVM) del stick ───────────────────────
    // La red Z-Wave vive en el stick: si se daña, restaurar un respaldo en el de
    // repuesto lo deja clonado y las cerraduras siguen funcionando sin tocarlas.
    async abrirRespaldos(controladorID) {
        let respaldos = [];
        try {
            const { data } = await api.get(`/cerraduras/controladores/${controladorID}/respaldos`);
            respaldos = data.respaldos || [];
        } catch (e) {
            return Swal.fire({ icon: 'error', title: 'Error', text: e.response?.data?.error || 'No se pudieron cargar los respaldos' });
        }
        const motivo = { NOCTURNO: '🌙 Nocturno', VINCULACION: '🔗 Tras vincular', EXCLUSION: '✂️ Tras excluir',
                         INICIAL: '⭐ Inicial', MANUAL: '👤 Manual' };
        const filas = respaldos.length ? respaldos.map(r => `
            <tr>
                <td>${r.FechaFmt}</td>
                <td>${motivo[r.Motivo] || r.Motivo}</td>
                <td style="text-align:center">${r.Nodos}</td>
                <td style="text-align:right">${Math.round(r.Tamano / 1024)} KB</td>
                <td style="text-align:right">
                    <button class="btn-neo btn-sm" title="Descargar (.zwbak) para guardarlo fuera del servidor"
                            onclick="CerradurasModule.descargarRespaldo(${r.RespaldoID})"><i class="fas fa-download"></i></button>
                </td>
            </tr>`).join('')
            : `<tr><td colspan="5" style="color:#718096;padding:12px">Todavía no hay respaldos. Se crean solos cada noche y tras vincular/excluir cerraduras.</td></tr>`;

        Swal.fire({
            title: 'Respaldos del stick',
            width: 720,
            html: `
                <p style="font-size:.85rem;color:#4a5568;text-align:left;margin:0 0 10px">
                    Si el stick se daña, restaura el respaldo más reciente en el de repuesto: queda clonado y
                    <b>todas las cerraduras siguen funcionando sin tocar ninguna puerta</b>.
                    Descarga una copia y guárdala fuera del servidor — <b>trátala como una llave maestra</b>.
                </p>
                <div style="max-height:300px;overflow:auto">
                <table style="width:100%;font-size:.82rem;border-collapse:collapse;text-align:left">
                    <thead><tr style="border-bottom:1px solid #cbd5e0"><th>Fecha</th><th>Motivo</th><th>Cerraduras</th><th style="text-align:right">Tamaño</th><th></th></tr></thead>
                    <tbody>${filas}</tbody>
                </table></div>
                <div style="display:flex;gap:8px;justify-content:center;margin-top:14px;flex-wrap:wrap">
                    <button class="btn-neo btn-prim" onclick="CerradurasModule.respaldarAhora(${controladorID})">
                        <i class="fas fa-save"></i> Respaldar ahora</button>
                    <button class="btn-neo" style="background:#c05621;color:#fff" onclick="CerradurasModule.restaurarStick(${controladorID})">
                        <i class="fas fa-undo"></i> Restaurar en stick de repuesto</button>
                </div>`,
            showConfirmButton: false,
            showCloseButton: true
        });
        this._respaldos = respaldos;
    },

    async cambiarPuerto(controladorID, actual) {
        Swal.fire({ title: 'Buscando sticks...', allowOutsideClick: false, showConfirmButton: false, didOpen: () => Swal.showLoading() });
        let libres = [];
        try {
            const { data } = await api.get('/cerraduras/controladores/detectar', { timeout: 60000 });
            libres = (data.sticks || []).filter(s => !s.enUso).map(s => s.puerto);
        } catch (_) {}
        if (!libres.length) return Swal.fire({ icon: 'info', title: 'No se encontró otro stick',
            text: `No hay ningún stick Z-Wave libre conectado. El controlador sigue en ${actual}.`, confirmButtonColor: '#1a365d' });
        const { value: puerto } = await Swal.fire({
            title: 'Cambiar puerto del controlador',
            html: `<p style="font-size:.85rem;color:#4a5568">Puerto actual: <b>${actual}</b>. No se modifica la red ni las cerraduras:
                   solo se conecta al stick que está en el puerto elegido.</p>`,
            input: 'select',
            inputOptions: Object.fromEntries(libres.map(p => [p, p])),
            showCancelButton: true, confirmButtonText: 'Cambiar', cancelButtonText: 'Cancelar', confirmButtonColor: '#1a365d'
        });
        if (!puerto) return;
        try {
            await api.put(`/cerraduras/controladores/${controladorID}/puerto`, { puerto });
            window.Toast?.fire({ icon: 'success', title: `Conectando en ${puerto}...` });
            setTimeout(() => this.cargarControladores(), 8000);
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: e.response?.data?.error || e.message });
        }
    },

    async respaldarAhora(controladorID) {
        Swal.fire({ title: 'Respaldando el stick...', text: 'La radio se pausa unos segundos mientras se lee la memoria',
            allowOutsideClick: false, showConfirmButton: false, didOpen: () => Swal.showLoading() });
        try {
            const { data } = await api.post(`/cerraduras/controladores/${controladorID}/respaldos`, {}, { timeout: 180000 });
            await Swal.fire({ icon: 'success', title: 'Respaldo creado',
                text: `${data.nodos} cerradura(s) · ${Math.round(data.tamano / 1024)} KB`, confirmButtonColor: '#1a365d' });
        } catch (e) {
            await Swal.fire({ icon: 'warning', title: 'No se pudo respaldar', text: e.response?.data?.error || e.message });
        }
        this.abrirRespaldos(controladorID);
    },

    async descargarRespaldo(respaldoId) {
        try {
            const res = await api.get(`/cerraduras/respaldos/${respaldoId}/descargar`, { timeout: 60000 });
            const nombre = (res.headers['content-disposition'] || '').match(/filename="([^"]+)"/)?.[1]
                || `stick_respaldo_${respaldoId}.zwbak`;
            const blob = new Blob([JSON.stringify(res.data)], { type: 'application/octet-stream' });
            const url  = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = nombre;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            window.Toast?.fire({ icon: 'success', title: 'Respaldo descargado — guárdalo en un lugar seguro' });
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: e.response?.data?.error || 'No se pudo descargar' });
        }
    },

    async restaurarStick(controladorID) {
        const respaldos = this._respaldos || [];
        // Puertos: el actual del controlador + sticks detectados libres
        let puertos = [];
        try {
            const { data } = await api.get('/cerraduras/controladores/detectar', { timeout: 60000 });
            puertos = (data.sticks || []).map(s => s.puerto);
        } catch (_) {}
        const ctrl = (this._controladores || []).find(c => c.ControladorID === controladorID);
        const actual = ctrl?.Puerto;
        if (actual && !puertos.includes(actual)) puertos.unshift(actual);

        const { value: form } = await Swal.fire({
            title: 'Restaurar en stick de repuesto',
            width: 620,
            html: `
                <div style="text-align:left;font-size:.85rem;color:#4a5568">
                    <ol style="padding-left:18px;margin:0 0 12px">
                        <li>Desconecta el stick dañado y conecta el de repuesto (mejor en el mismo puerto USB).</li>
                        <li>Elige el respaldo — normalmente el más reciente.</li>
                        <li>El stick de repuesto se borra y queda como copia exacta del original.</li>
                    </ol>
                    <label style="font-weight:700">Respaldo</label>
                    <select id="rs-origen" class="swal2-select" style="width:100%;margin:4px 0 10px;font-size:.85rem">
                        ${respaldos.map((r, i) => `<option value="${r.RespaldoID}">${r.FechaFmt} · ${r.Nodos} cerradura(s)${i === 0 ? ' (más reciente)' : ''}</option>`).join('')}
                        <option value="archivo">Desde un archivo .zwbak descargado…</option>
                    </select>
                    <input type="file" id="rs-archivo" accept=".zwbak" style="display:${respaldos.length ? 'none' : 'block'};margin-bottom:10px">
                    <label style="font-weight:700">Puerto del stick de repuesto</label>
                    <select id="rs-puerto" class="swal2-select" style="width:100%;margin:4px 0 10px;font-size:.85rem">
                        ${puertos.map(p => `<option value="${p}">${p}${p === actual ? ' (actual)' : ''}</option>`).join('')}
                    </select>
                    <label style="font-weight:700">Escribe RESTAURAR para confirmar</label>
                    <input id="rs-confirmar" class="swal2-input" style="margin:4px 0 0;width:100%" autocomplete="off">
                </div>`,
            didOpen: () => {
                const sel = document.getElementById('rs-origen');
                if (!respaldos.length) sel.value = 'archivo';
                sel.onchange = () => { document.getElementById('rs-archivo').style.display = sel.value === 'archivo' ? 'block' : 'none'; };
            },
            showCancelButton: true,
            confirmButtonText: 'Restaurar',
            confirmButtonColor: '#c05621',
            cancelButtonText: 'Cancelar',
            preConfirm: async () => {
                if (document.getElementById('rs-confirmar').value.trim().toUpperCase() !== 'RESTAURAR')
                    return Swal.showValidationMessage('Escribe RESTAURAR para confirmar');
                const origen = document.getElementById('rs-origen').value;
                const puerto = document.getElementById('rs-puerto').value || null;
                if (origen !== 'archivo') return { respaldoId: parseInt(origen), puerto };
                const f = document.getElementById('rs-archivo').files[0];
                if (!f) return Swal.showValidationMessage('Elige el archivo .zwbak');
                try {
                    const archivo = JSON.parse(await f.text());
                    if (archivo.formato !== 'masterhotel-zwave-respaldo') throw new Error();
                    return { archivo, puerto };
                } catch (_) {
                    return Swal.showValidationMessage('El archivo no es un respaldo válido (.zwbak)');
                }
            }
        });
        if (form) this._ejecutarRestauracion(controladorID, form);
    },

    async _ejecutarRestauracion(controladorID, form) {
        try {
            await api.post(`/cerraduras/controladores/${controladorID}/restaurar`, form, { timeout: 60000 });
        } catch (e) {
            return Swal.fire({ icon: 'error', title: 'No se pudo iniciar', text: e.response?.data?.error || e.message });
        }
        const FASE = { EN_COLA: 'En cola…', CONECTANDO: 'Conectando con el stick…', CONVIRTIENDO: 'Preparando el respaldo…',
                       ESCRIBIENDO: 'Escribiendo en el stick — no lo desconectes', REINICIANDO: 'Reiniciando el stick…' };
        Swal.fire({ title: 'Restaurando stick', html: '<div id="rs-estado">Iniciando…</div>',
            allowOutsideClick: false, showConfirmButton: false, didOpen: () => Swal.showLoading() });

        for (;;) {
            await new Promise(r => setTimeout(r, 2000));
            let st;
            try { st = (await api.get(`/cerraduras/controladores/${controladorID}/restaurar/estado`)).data; }
            catch (_) { continue; }
            if (st.fase === 'COMPLETADO') {
                await Swal.fire({ icon: 'success', title: 'Stick restaurado',
                    html: `La red quedó clonada con <b>${st.nodos}</b> cerradura(s).<br>Prueba abrir/cerrar una desde el Monitor.`,
                    confirmButtonColor: '#1a365d' });
                return this.cargarControladores();
            }
            if (st.fase === 'ERROR') {
                if (st.codigo === 'STICK_CON_DISPOSITIVOS') {
                    const ok = await Swal.fire({ icon: 'warning', title: '¿Es el stick correcto?', text: st.error,
                        showCancelButton: true, confirmButtonText: 'Sí, reemplazar su red', confirmButtonColor: '#c0392b',
                        cancelButtonText: 'Cancelar' });
                    if (ok.isConfirmed) return this._ejecutarRestauracion(controladorID, { ...form, forzar: true });
                    return;
                }
                return Swal.fire({ icon: 'error', title: 'La restauración falló', text: st.error });
            }
            const el = document.getElementById('rs-estado');
            if (el) el.textContent = `${FASE[st.fase] || st.fase}${st.progreso ? ` ${st.progreso}%` : ''}`;
        }
    },

    async excluirDispositivo(controladorID) {
        try {
            await api.post('/cerraduras/exclusion/iniciar', { controladorID });
        } catch (e) {
            return Swal.fire({ icon: 'error', title: 'No se pudo iniciar la exclusión',
                text: e.response?.data?.error || e.message, confirmButtonColor: '#1a365d' });
        }

        let poll = null;
        const fin = () => { if (poll) clearInterval(poll); poll = null; };
        const resultado = new Promise(resolve => {
            poll = setInterval(async () => {
                try {
                    const { data } = await api.get(`/cerraduras/exclusion/estado/${controladorID}`);
                    if (data.fase === 'COMPLETADO' || data.fase === 'ERROR') { fin(); resolve(data); }
                } catch (_) {}
            }, 2000);
        });

        const swal = Swal.fire({
            title: 'Modo exclusión activo',
            html: `Haz en la cerradura la secuencia de exclusión<br>
                   (normalmente la misma que para vincularla).<br><br>
                   <small style="color:#718096">Se cancela solo a los 90 segundos.</small>`,
            allowOutsideClick: false,
            showConfirmButton: false,
            showCancelButton:  true,
            cancelButtonText:  'Cancelar',
            didOpen: () => Swal.showLoading()
        }).then(r => r.dismiss === Swal.DismissReason.cancel ? { fase: 'CANCELADO' } : null);

        const data = await Promise.race([resultado, swal]);
        fin();
        if (data.fase === 'CANCELADO') {
            await api.post('/cerraduras/exclusion/cancelar', { controladorID }).catch(() => {});
            return;
        }
        await api.delete(`/cerraduras/exclusion/${controladorID}`).catch(() => {});
        if (data.fase === 'COMPLETADO') {
            Swal.fire({ icon: 'success', title: 'Dispositivo excluido',
                text: data.nodeId
                    ? `Node ${data.nodeId} borrado del stick y de la cerradura.`
                    : 'La cerradura salió de su red anterior y quedó lista para vincularse.',
                confirmButtonColor: '#1a365d' });
        } else {
            Swal.fire({ icon: 'error', title: 'Exclusión fallida', text: data.error || 'Error desconocido',
                confirmButtonColor: '#1a365d' });
        }
        this.cargarMonitor();
        this.cargarControladores();
    },

    // ── Vinculación ───────────────────────────────────────────────────
    async _cargarSelectores() {
        try {
            const [cRes, hRes] = await Promise.all([
                api.get(`/cerraduras/controladores?sedeId=${this._sedeId || ''}`),
                api.get(`/habitaciones/sede/${this._sedeId || 1}`)
            ]);
            const selCtrl = document.getElementById('sel-controlador');
            const selHab  = document.getElementById('sel-habitacion');
            selCtrl.innerHTML = (cRes.data.controladores || [])
                .map(c => `<option value="${c.ControladorID}">${c.Descripcion || c.Puerto} (${c.Puerto})</option>`)
                .join('') || '<option value="">Sin controladores</option>';
            selHab.innerHTML  = (Array.isArray(hRes.data) ? hRes.data : [])
                .filter(h => h.Estado !== 'FUERA_DE_SERVICIO')
                .map(h => `<option value="${h.HabitacionID}">Hab. ${h.NroHabitacion} — ${h.Descripcion||''}</option>`)
                .join('') || '<option value="">Sin habitaciones</option>';
        } catch (_) {}
    },

    // ── Códigos maestro / personal ───────────────────────────────────
    async cargarCodigos() {
        try {
            const { data } = await api.get(`/cerraduras/codigos?sedeId=${this._sedeId || ''}`);
            const codigos  = data.codigos || [];
            const maestro  = codigos.find(c => c.Tipo === 'MAESTRO');
            const personal = codigos.filter(c => c.Tipo === 'PERSONAL');

            document.getElementById('codigo-maestro').innerHTML = maestro
                ? this._filaCodigo(maestro)
                : `<button class="btn-neo btn-prim" style="width:100%;justify-content:center"
                           onclick="CerradurasModule.nuevoCodigo('MAESTRO')">
                       <i class="fas fa-crown"></i> Crear código maestro
                   </button>`;
            document.getElementById('codigos-personal').innerHTML = personal.length
                ? personal.map(c => this._filaCodigo(c)).join('')
                : '<p style="color:var(--grey);font-size:.82rem">Aún no hay códigos de personal.</p>';
        } catch (e) {
            document.getElementById('codigos-personal').innerHTML =
                `<p style="color:#e74c3c;font-size:.82rem">${e.response?.data?.error || 'Error cargando códigos'}</p>`;
        }
    },

    _filaCodigo(c) {
        // Estado de carga en las cerraduras: "8/10" — si alguna está sin señal se reintenta sola
        const completo = c.TotalCerraduras > 0 && c.Cargadas >= c.TotalCerraduras;
        const estado = c.TotalCerraduras === 0
            ? '<span style="color:var(--grey)">Sin cerraduras vinculadas</span>'
            : completo
                ? `<span style="color:#27ae60"><i class="fas fa-check-circle"></i> En ${c.Cargadas}/${c.TotalCerraduras} cerraduras</span>`
                : `<span style="color:#c5a059"><i class="fas fa-sync"></i> Cargando: ${c.Cargadas}/${c.TotalCerraduras}` +
                  `${c.ConError ? ` · ${c.ConError} sin señal (se reintenta)` : ''}</span>`;
        const nombre = String(c.Nombre).replace(/'/g, "\\'").replace(/"/g, '&quot;');
        return `
        <div class="cod-fila">
            <div style="flex:1;min-width:0">
                <div style="font-weight:800;font-size:.85rem">${c.Nombre}</div>
                <div class="cod-num" id="cod-${c.CodigoID}" data-codigo="${c.Codigo}">••••••</div>
                <div style="font-size:.7rem;margin-top:2px">${estado}</div>
            </div>
            <button class="btn-neo btn-sm" title="Ver código" onclick="CerradurasModule.verCodigo(${c.CodigoID})">
                <i class="fas fa-eye"></i></button>
            <button class="btn-neo btn-sm" title="Cambiar código"
                    onclick="CerradurasModule.cambiarCodigo(${c.CodigoID}, '${nombre}')">
                <i class="fas fa-redo"></i></button>
            ${c.Tipo === 'PERSONAL' ? `
            <button class="btn-neo btn-sm btn-danger" title="Dar de baja"
                    onclick="CerradurasModule.bajaCodigo(${c.CodigoID}, '${nombre}')">
                <i class="fas fa-user-slash"></i></button>` : ''}
        </div>`;
    },

    verCodigo(id) {
        const el = document.getElementById(`cod-${id}`);
        if (!el) return;
        el.textContent = el.textContent.startsWith('•') ? el.dataset.codigo : '••••••';
    },

    async nuevoCodigo(tipo) {
        const esMaestro = tipo === 'MAESTRO';
        const { value: datos } = await Swal.fire({
            title: esMaestro ? 'Crear código maestro' : 'Agregar persona',
            html: `
                <div style="text-align:left">
                    <label style="font-size:.78rem;font-weight:700;color:#718096">${esMaestro ? 'NOMBRE DEL DUEÑO' : 'NOMBRE Y CARGO'}</label>
                    <input id="sw-cod-nombre" class="swal2-input" placeholder="${esMaestro ? 'Ej. Juan José Castillo' : 'Ej. Carlos Pérez — Mantenimiento'}">
                    <label style="font-size:.78rem;font-weight:700;color:#718096">CÓDIGO (opcional)</label>
                    <input id="sw-cod-codigo" class="swal2-input" inputmode="numeric" maxlength="8"
                           placeholder="Vacío = el sistema genera uno de 6 dígitos">
                </div>`,
            showCancelButton: true, confirmButtonText: 'Crear', cancelButtonText: 'Cancelar',
            confirmButtonColor: '#1a365d',
            preConfirm: () => {
                const nombre = document.getElementById('sw-cod-nombre').value.trim();
                const codigo = document.getElementById('sw-cod-codigo').value.trim();
                if (!nombre) { Swal.showValidationMessage('Escribe el nombre'); return false; }
                if (codigo && !/^\d{6,8}$/.test(codigo)) { Swal.showValidationMessage('El código debe tener de 6 a 8 dígitos'); return false; }
                return { nombre, codigo: codigo || undefined };
            }
        });
        if (!datos) return;
        try {
            const { data } = await api.post('/cerraduras/codigos', { sedeId: this._sedeId, tipo, ...datos });
            await Swal.fire({
                icon: 'success', title: esMaestro ? 'Código maestro creado' : 'Código creado',
                html: `<div style="font-size:2rem;font-weight:900;letter-spacing:6px;color:#1a365d">${data.codigo}</div>
                       <small style="color:#718096">Se está cargando en todas las cerraduras.</small>`,
                confirmButtonColor: '#1a365d'
            });
            this.cargarCodigos();
            setTimeout(() => this.cargarCodigos(), 8000);
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'No se pudo crear', text: e.response?.data?.error || e.message,
                confirmButtonColor: '#1a365d' });
        }
    },

    async cambiarCodigo(id, nombre) {
        const r = await Swal.fire({
            title: `Cambiar código de ${nombre}`,
            html: `<input id="sw-cod-nuevo" class="swal2-input" inputmode="numeric" maxlength="8"
                          placeholder="Vacío = generar uno nuevo de 6 dígitos">
                   <small style="color:#718096">El código anterior deja de funcionar en todas las puertas.</small>`,
            showCancelButton: true, confirmButtonText: 'Cambiar', cancelButtonText: 'Cancelar',
            confirmButtonColor: '#1a365d',
            preConfirm: () => {
                const v = document.getElementById('sw-cod-nuevo').value.trim();
                if (v && !/^\d{6,8}$/.test(v)) { Swal.showValidationMessage('El código debe tener de 6 a 8 dígitos'); return false; }
                return { codigo: v || undefined, regenerar: !v };
            }
        });
        if (!r.isConfirmed) return;
        try {
            const { data } = await api.put(`/cerraduras/codigos/${id}`, r.value);
            await Swal.fire({ icon: 'success', title: 'Código cambiado',
                html: `<div style="font-size:2rem;font-weight:900;letter-spacing:6px;color:#1a365d">${data.codigo}</div>`,
                confirmButtonColor: '#1a365d' });
            this.cargarCodigos();
            setTimeout(() => this.cargarCodigos(), 8000);
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: e.response?.data?.error || e.message, confirmButtonColor: '#1a365d' });
        }
    },

    async bajaCodigo(id, nombre) {
        const r = await Swal.fire({ icon: 'warning', title: `¿Dar de baja a ${nombre}?`,
            text: 'Su código se borra de todas las cerraduras. Su historial de aperturas se conserva.',
            showCancelButton: true, confirmButtonText: 'Dar de baja', cancelButtonText: 'Cancelar',
            confirmButtonColor: '#e74c3c' });
        if (!r.isConfirmed) return;
        try {
            await api.delete(`/cerraduras/codigos/${id}`);
            this.cargarCodigos();
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: e.response?.data?.error || e.message, confirmButtonColor: '#1a365d' });
        }
    },

    // ── Registro de aperturas ────────────────────────────────────────
    _iniciarRegistro() {
        const hoy = new Date();
        const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const desde = document.getElementById('reg-desde');
        if (!desde.value) {
            desde.value = iso(new Date(hoy.getTime() - 6 * 86400000));
            document.getElementById('reg-hasta').value = iso(hoy);
        }
        this.cargarRegistro();
    },

    async cargarRegistro() {
        const body = document.getElementById('reg-body');
        const q = new URLSearchParams({
            sedeId:      this._sedeId || '',
            fechaInicio: document.getElementById('reg-desde').value,
            fechaFin:    document.getElementById('reg-hasta').value,
            tipoCodigo:  document.getElementById('reg-tipo').value
        });
        try {
            const { data } = await api.get(`/cerraduras/eventos?${q}`);
            const ev = data.eventos || [];
            this._eventos = ev;   // para imprimir lo mismo que se ve
            if (!ev.length) { body.innerHTML = '<tr><td colspan="6" style="color:var(--grey)">Sin aperturas en ese rango.</td></tr>'; return; }
            const etiqueta = ETIQUETA_EVENTO, quien = quienEvento, dur = duracionTxt;
            body.innerHTML = ev.map(e => {
                const apertura = e.Tipo.startsWith('APERTURA');
                const alerta = esAlerta(e);
                return `<tr style="${alerta ? 'background:rgba(231,76,60,.10);color:#c0392b'
                                   : e.TipoCodigo === 'PERSONAL' ? 'background:rgba(197,160,89,.08)' : ''}">
                    <td>${e.FechaFmt}</td>
                    <td><b>${e.NroHabitacion}</b></td>
                    <td>${etiqueta[e.Tipo] || e.Detalle || e.Tipo}</td>
                    <td>${quien(e)}</td>
                    <td>${apertura ? (e.CierreFmt || '<span style="color:#c5a059">sigue abierta</span>') : ''}</td>
                    <td><b>${apertura ? dur(e.DuracionSeg) : ''}</b></td>
                </tr>`;
            }).join('');
        } catch (e) {
            body.innerHTML = `<tr><td colspan="6" style="color:#e74c3c">${e.response?.data?.error || 'Error cargando el registro'}</td></tr>`;
        }
    },

    // Reporte impreso (A4) del registro filtrado, agrupado por día en orden cronológico
    imprimirRegistro() {
        const ev = this._eventos || [];
        if (!ev.length) return Swal.fire({ icon: 'info', title: 'No hay eventos para imprimir',
            text: 'Busca primero el rango de fechas.', confirmButtonColor: '#1a365d' });
        const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const sinIcono = t => String(t || '').replace(/^\S+\s/, '');   // las etiquetas empiezan con un ícono
        const desde = document.getElementById('reg-desde').value.split('-').reverse().join('/');
        const hasta = document.getElementById('reg-hasta').value.split('-').reverse().join('/');
        const selTipo = document.getElementById('reg-tipo');
        const filtro  = selTipo.value ? selTipo.options[selTipo.selectedIndex].text : 'Todos';

        // FechaFmt = 'dd/MM/yyyy HH:mm:ss' (formateada en SQL); EventoID da el orden real
        const dias = new Map();
        [...ev].sort((a, b) => a.EventoID - b.EventoID).forEach(e => {
            const dia = e.FechaFmt.slice(0, 10);
            if (!dias.has(dia)) dias.set(dia, []);
            dias.get(dia).push(e);
        });

        let html = `
            <div style="display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid #1a365d; padding-bottom:6px; margin-bottom:10px;">
                <div><div class="t-title">${esc((App.sedeNombre && App.sedeNombre()) || 'Hotel')}</div>
                     <div>Registro de aperturas de cerraduras</div></div>
                <div class="t-right t-sm">Del ${esc(desde)} al ${esc(hasta)}<br>Quién: ${esc(filtro)}</div>
            </div>`;
        for (const [dia, lista] of dias) {
            const aperturas = lista.filter(e => e.Tipo.startsWith('APERTURA')).length;
            const alertas   = lista.filter(esAlerta).length;
            html += `
            <div style="margin-top:14px; background:#1a365d; color:#fff; padding:4px 8px; font-weight:bold; display:flex; justify-content:space-between; -webkit-print-color-adjust:exact; print-color-adjust:exact;">
                <span>${esc(dia)}</span>
                <span>${aperturas} apertura(s)${alertas ? ` · ${alertas} alerta(s)` : ''}</span>
            </div>
            <table style="font-size:.92em;">
                <tr style="border-bottom:1px solid #000; font-weight:bold;">
                    <td>Hora</td><td>Hab.</td><td>Evento</td><td>Quién</td><td>Se cerró</td><td class="t-right">Tiempo dentro</td></tr>
                ${lista.map(e => {
                    const apertura = e.Tipo.startsWith('APERTURA');
                    const alerta   = esAlerta(e);
                    return `<tr style="border-bottom:1px solid #ddd;${alerta ? ' color:#c0392b; font-weight:bold;' : ''}">
                        <td>${esc(e.FechaFmt.slice(11))}</td>
                        <td>${esc(e.NroHabitacion)}</td>
                        <td>${esc(sinIcono(ETIQUETA_EVENTO[e.Tipo]) || e.Detalle || e.Tipo)}</td>
                        <td>${esc(sinIcono(quienEvento(e)))}</td>
                        <td>${apertura ? esc(e.CierreFmt || 'sigue abierta') : ''}</td>
                        <td class="t-right">${apertura ? esc(duracionTxt(e.DuracionSeg)) : ''}</td></tr>`;
                }).join('')}
            </table>`;
        }
        html += `<div class="t-sm" style="margin-top:16px; border-top:1px solid #000; padding-top:4px;">
            Total: ${ev.length} evento(s)${ev.length >= 500 ? ' (máximo 500 — acota el rango de fechas para ver todo)' : ''}</div>`;
        pt.imprimir(html, { titulo: `Registro de aperturas ${desde} - ${hasta}`, formato: 'a4' });
    },

    // ── Long Range (SmartStart) ──────────────────────────────────────
    async registrarLongRange() {
        const controladorID = document.getElementById('sel-controlador').value;
        const habitacionID  = document.getElementById('sel-habitacion').value;
        const codigo        = document.getElementById('inp-dsk').value.trim();
        if (!controladorID || !habitacionID) {
            return Swal.fire({ icon: 'warning', title: 'Selecciona controlador y habitación',
                confirmButtonColor: '#1a365d' });
        }
        if (!codigo) {
            return Swal.fire({ icon: 'warning', title: 'Escribe los 40 dígitos de la etiqueta',
                confirmButtonColor: '#1a365d' });
        }
        try {
            const { data } = await api.post('/cerraduras/smartstart', { controladorID, habitacionID, codigo });
            document.getElementById('inp-dsk').value = '';
            Swal.fire({
                icon: 'success',
                title: data.longRange ? 'Registrada para Long Range' : 'Registrada (SmartStart)',
                html: `Ahora <b>quita y vuelve a poner las baterías</b> de la cerradura.<br>
                       Se unirá sola en unos segundos (puede tardar hasta un par de minutos).<br><br>
                       <small style="color:#718096">Si la cerradura ya estaba vinculada, primero exclúyela.</small>`,
                confirmButtonColor: '#1a365d'
            });
            this.cargarLongRange();
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'No se pudo registrar', text: e.response?.data?.error || e.message,
                confirmButtonColor: '#1a365d' });
        }
    },

    async cargarLongRange() {
        const cont = document.getElementById('lr-lista');
        const controladorID = document.getElementById('sel-controlador')?.value;
        if (!cont || !controladorID) {
            if (!cont && this._lrTimer) { clearInterval(this._lrTimer); this._lrTimer = null; }
            return;
        }
        try {
            const { data } = await api.get(`/cerraduras/smartstart/${controladorID}`);
            const regs = data.registros || [];
            if (!regs.length) { cont.innerHTML = ''; return; }
            const est = {
                ESPERANDO:  ['#c5a059', 'fa-hourglass-half', 'Esperando que la cerradura se anuncie'],
                COMPLETADO: ['#27ae60', 'fa-check-circle',   'Vinculada'],
                ERROR:      ['#e74c3c', 'fa-times-circle',   'Error']
            };
            cont.innerHTML = regs.map(r => {
                const [color, icon, txt] = est[r.fase] || est.ESPERANDO;
                return `
                <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;margin-bottom:6px;
                            border-radius:10px;background:var(--bg);box-shadow:inset 2px 2px 5px var(--sd),inset -2px -2px 5px var(--sl)">
                    <i class="fas ${icon}" style="color:${color}"></i>
                    <div style="flex:1;font-size:.78rem">
                        <b>Hab. ${r.NroHabitacion ?? r.habitacionID}</b>
                        ${r.longRange ? '<span style="color:#1a365d">· Long Range</span>' : ''}
                        ${r.nodeId ? `· Node ${r.nodeId}` : ''}<br>
                        <span style="color:${color}">${r.error || txt}</span>
                    </div>
                    ${r.fase === 'ESPERANDO' ? `
                    <button class="btn-neo btn-sm btn-danger" title="Cancelar registro"
                            onclick="CerradurasModule.cancelarLongRange(${controladorID}, '${r.dsk}')">
                        <i class="fas fa-times"></i>
                    </button>` : ''}
                </div>`;
            }).join('');
            // Refresca el monitor solo cuando una cerradura recién se vincula
            const nuevas = regs.filter(r => r.fase === 'COMPLETADO' && !this._lrVinculadas.has(r.dsk));
            nuevas.forEach(r => this._lrVinculadas.add(r.dsk));
            if (nuevas.length) this.cargarMonitor();
        } catch (_) {}
    },

    async cancelarLongRange(controladorID, dsk) {
        try {
            await api.delete(`/cerraduras/smartstart/${controladorID}/${encodeURIComponent(dsk)}`);
            this.cargarLongRange();
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: e.response?.data?.error || e.message,
                confirmButtonColor: '#1a365d' });
        }
    },

    async iniciarVinculacion() {
        const controladorID = document.getElementById('sel-controlador').value;
        const habitacionID  = document.getElementById('sel-habitacion').value;
        const pin           = (document.getElementById('inp-pin-previo')?.value || '').trim();
        if (!controladorID || !habitacionID) {
            return Swal.fire({ icon: 'warning', title: 'Selecciona controlador y habitación',
                confirmButtonColor: '#1a365d' });
        }
        if (pin && !/^\d{5}$/.test(pin)) {
            return Swal.fire({ icon: 'warning', title: 'El PIN debe tener 5 dígitos',
                confirmButtonColor: '#1a365d' });
        }
        try {
            await api.post('/cerraduras/inclusion/iniciar', { controladorID, habitacionID, pin: pin || undefined });
            document.getElementById('inp-pin-previo').value = '';
            this._ctrlActivo = parseInt(controladorID);
            this._mostrarWizard('step-esperar');
            this._iniciarCountdown(90);
            this._pollInc = setInterval(() => this._pollInclusion(), 2000);
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error al iniciar', text: e.response?.data?.error || e.message,
                confirmButtonColor: '#1a365d' });
        }
    },

    _mostrarWizard(paso) {
        document.getElementById('wizard-overlay').classList.add('visible');
        ['step-esperar','step-pin','step-ok','step-error'].forEach(s => {
            document.getElementById(s).classList.toggle('activo', s === paso);
        });
        document.getElementById('wizard-btn-pin').style.display    = paso === 'step-pin' ? '' : 'none';
        document.getElementById('wizard-btn-cerrar').style.display = ['step-ok','step-error'].includes(paso) ? '' : 'none';
        document.getElementById('wizard-btn-cancelar').style.display = ['step-ok','step-error'].includes(paso) ? 'none' : '';
    },

    _iniciarCountdown(seg) {
        let t = seg;
        document.getElementById('wizard-countdown').textContent = t;
        if (this._countTimer) clearInterval(this._countTimer);
        this._countTimer = setInterval(() => {
            t--;
            document.getElementById('wizard-countdown').textContent = t;
            if (t <= 0) clearInterval(this._countTimer);
        }, 1000);
    },

    async _pollInclusion() {
        if (!this._ctrlActivo) return;
        if (!document.getElementById('wizard-overlay')) { this._limpiarPollInc(); return; }
        try {
            const res = await api.get(`/cerraduras/inclusion/estado/${this._ctrlActivo}`);
            const { fase, dsk, error } = res.data;

            if (fase === 'ESPERANDO_PIN') {
                clearInterval(this._countTimer);
                document.getElementById('wizard-dsk').textContent = dsk || '?????';
                this._mostrarWizard('step-pin');
            } else if (fase === 'COMPLETADO') {
                this._limpiarPollInc();
                this._mostrarWizard('step-ok');
                await api.delete(`/cerraduras/inclusion/${this._ctrlActivo}`);
                this.cargarMonitor();
            } else if (fase === 'ERROR') {
                this._limpiarPollInc();
                document.getElementById('wizard-error-txt').textContent = error || 'Error desconocido.';
                this._mostrarWizard('step-error');
            }
        } catch (_) {}
    },

    async enviarPin() {
        const pin = document.getElementById('wizard-pin').value.trim();
        if (pin.length !== 5) {
            return Swal.fire({ icon: 'warning', title: 'El PIN debe tener 5 dígitos',
                confirmButtonColor: '#1a365d' });
        }
        try {
            await api.post('/cerraduras/inclusion/pin', { controladorID: this._ctrlActivo, pin });
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: e.response?.data?.error || e.message,
                confirmButtonColor: '#1a365d' });
        }
    },

    async cancelarVinculacion() {
        this._limpiarPollInc();
        if (this._ctrlActivo)
            await api.post('/cerraduras/inclusion/cancelar', { controladorID: this._ctrlActivo }).catch(() => {});
        this.cerrarWizard();
    },

    _limpiarPollInc() {
        if (this._pollInc)  clearInterval(this._pollInc);
        if (this._countTimer) clearInterval(this._countTimer);
        this._pollInc = null;
    },

    cerrarWizard() {
        this._limpiarPollInc();
        this._ctrlActivo = null;
        document.getElementById('wizard-overlay').classList.remove('visible');
        document.getElementById('wizard-pin').value = '';
    },

    destroy() {
        if (this._lrTimer)   clearInterval(this._lrTimer);
        if (this._pollTimer) clearInterval(this._pollTimer);
        if (this._pollInc)   clearInterval(this._pollInc);
        if (this._countTimer) clearInterval(this._countTimer);
    }
};

module.exports = CerradurasModule;
