const api = require('./api');

const CerradurasModule = {
    _tab:         'monitor',
    _pollTimer:   null,
    _countTimer:  null,
    _pollInc:     null,
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
    },

    switchTab(tab) {
        this._tab = tab;
        ['monitor','controladores','vincular'].forEach(t => {
            document.getElementById(`panel-${t}`).style.display   = t === tab ? '' : 'none';
            document.getElementById(`tab-${t}`).classList.toggle('activo', t === tab);
        });
        if (tab === 'controladores') this.cargarControladores();
        if (tab === 'vincular')      this._cargarSelectores();
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
            this._renderControladores(res.data.controladores || []);
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
                <div class="ctrl-meta"><i class="fas fa-plug"></i> Puerto: <strong>${c.Puerto}</strong></div>
                <div class="ctrl-meta"><i class="fas fa-hotel"></i> Sede: ${c.NombreSede}</div>
                <div class="ctrl-meta"><i class="fas fa-lock"></i> Cerraduras: ${c.TotalCerraduras}</div>
                <div class="ctrl-meta"><i class="fas fa-wifi"></i> Nodos Z-Wave: ${c.estadoServicio?.nodos ?? '—'}</div>
                <div class="ctrl-actions">
                    <button class="btn-neo btn-sm btn-danger"
                            onclick="CerradurasModule.eliminarControlador(${c.ControladorID}, '${c.Puerto}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    },

    async abrirWizardControlador() {
        const { value: datos } = await Swal.fire({
            title: 'Agregar Controlador Z-Wave',
            html: `
                <div style="text-align:left;margin-bottom:10px">
                    <label style="font-size:.78rem;font-weight:700;color:#718096">PUERTO USB (ej. COM3)</label>
                    <input id="sw-puerto" class="swal2-input" placeholder="COM3" style="font-size:1rem;letter-spacing:2px">
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
                puerto:      document.getElementById('sw-puerto').value.trim().toUpperCase(),
                descripcion: document.getElementById('sw-desc').value.trim()
            })
        });
        if (!datos?.puerto) return;
        try {
            await api.post('/cerraduras/controladores', {
                sedeId: this._sedeId, ...datos
            });
            Swal.fire({ icon: 'success', title: 'Controlador agregado',
                text: 'El sistema intentará conectarse automáticamente.', timer: 2000, showConfirmButton: false });
            this.cargarControladores();
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

    async iniciarVinculacion() {
        const controladorID = document.getElementById('sel-controlador').value;
        const habitacionID  = document.getElementById('sel-habitacion').value;
        if (!controladorID || !habitacionID) {
            return Swal.fire({ icon: 'warning', title: 'Selecciona controlador y habitación',
                confirmButtonColor: '#1a365d' });
        }
        try {
            await api.post('/cerraduras/inclusion/iniciar', { controladorID, habitacionID });
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
        if (this._pollTimer) clearInterval(this._pollTimer);
        if (this._pollInc)   clearInterval(this._pollInc);
        if (this._countTimer) clearInterval(this._countTimer);
    }
};

module.exports = CerradurasModule;
