// usuarios.js - Gestión de Usuarios | HotelMasterDB
const api = require('./api'); 

const UsuariosModule = {
    editandoID: null, 

    init() {
        console.log("Modulo Usuarios (Hotel): Activo");
        this.listarUsuarios();
        this.setupEventListeners();
        
        window.UsuariosModule = this;
    },

    // 1. LISTADO DE PERSONAL (ACTUALIZADO CON LÓGICA DUAL)
    async listarUsuarios() {
        try {
            const res = await api.get('/admin/usuarios');
            const usuarios = res.data;
            const body = document.getElementById('tablaUsuariosBody');
            if (!body) return;

            body.innerHTML = usuarios.map(u => {
                // Definimos el estilo del botón según el estado
                const btnClass = u.Estado ? 'btn-delete' : 'btn-activate';
                const btnIcon = u.Estado ? 'fa-user-slash' : 'fa-user-check';
                const btnColor = u.Estado ? '' : 'style="background: #27ae60; color: white;"';

                return `
                <tr>
                    <td>
                        <div class="user-info">
                            <strong>${u.NombreFull}</strong><br>
                            <small class="text-muted">${u.Cedula || 'S/C'}</small>
                        </div>
                    </td>
                    <td>${u.Usuario}</td>
                    <td><span class="badge-rol">${u.NombreRol || 'SIN ROL'}</span></td>
                    <td>${u.Sede || 'SIN SEDE'}</td>
                    <td>
                        <span class="status-pill ${u.Estado ? 'active' : 'inactive'}">
                            ${u.Estado ? 'ACTIVO' : 'INACTIVO'}
                        </span>
                    </td>
                    <td>
                        <div class="actions">
                            <button class="btn-edit" onclick='UsuariosModule.prepararEdicion(${JSON.stringify(u)})' title="Editar">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="${btnClass}" ${btnColor} onclick='UsuariosModule.toggleEstadoUsuario(${JSON.stringify(u)})' title="${u.Estado ? 'Desactivar' : 'Activar'}">
                                <i class="fas ${btnIcon}"></i>
                            </button>
                            ${parseInt(u.RolID) !== 1 ? `<button class="btn-edit btn-perm" onclick="UsuariosModule.permisosUsuario(${u.UsuarioID})" title="Permisos de esta persona (excepciones a su rol)">
                                <i class="fas fa-key"></i>
                            </button>` : ''}
                        </div>
                    </td>
                </tr>
            `}).join('');
        } catch (error) {
            console.error("Error en listarUsuarios:", error);
        }
    },

    // 2. CARGA DE SELECTORES (Roles y Sedes)
    async cargarSelectores() {
        try {
            const [resRoles, resSedes] = await Promise.all([
                api.get('/admin/roles'),
                api.get('/admin/sedes')
            ]);

            const selRol = document.getElementById('rolId');
            const selSede = document.getElementById('sedeId');

            if (selRol && resRoles.data) {
                selRol.innerHTML = '<option value="">SELECCIONE ROL</option>';
                resRoles.data.forEach(r => {
                    const opt = document.createElement('option');
                    opt.value = r.RolID;
                    opt.textContent = r.NombreRol.toUpperCase();
                    selRol.appendChild(opt);
                });
            }

            if (selSede && resSedes.data) {
                selSede.innerHTML = '<option value="">SELECCIONE SEDE</option>';
                resSedes.data.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s.SedeID;
                    opt.textContent = s.NombreComercial.toUpperCase();
                    selSede.appendChild(opt);
                });
            }
        } catch (error) {
            console.error("Error en cargarSelectores:", error);
        }
    },

    // 3. CONTROL DE MODAL
    async abrirModal(esEdicion = false) {
        const modal = document.getElementById('modalUsuario');
        const form = document.getElementById('formUsuario');
        
        if (!modal) return;

        if (!esEdicion) {
            this.editandoID = null;
            if (form) form.reset();
            document.getElementById('modalTitulo').textContent = "REGISTRAR NUEVO PERSONAL";
            
            const passField = document.getElementById('password');
            if(passField) {
                passField.placeholder = "CONTRASEÑA";
                passField.required = true;
            }
        }

        modal.classList.remove('hidden');
        await this.cargarSelectores();
    },

    cerrarModal() {
        const modal = document.getElementById('modalUsuario');
        if (modal) modal.classList.add('hidden');
        this.editandoID = null;
    },

    // 4. EVENTOS DE FORMULARIO
    setupEventListeners() {
        const form = document.getElementById('formUsuario');
        if (!form) return;

        form.onsubmit = async (e) => {
            e.preventDefault();
            
            const userLogueado = JSON.parse(localStorage.getItem('user')) || {};
            const rEjecutor = userLogueado.rolId || userLogueado.RolID || 0;
            
            const datos = {
                nombre: document.getElementById('nombre').value.trim(),
                cedula: document.getElementById('cedula').value.trim(),
                telefono: document.getElementById('telefono').value.trim(),
                direccion: document.getElementById('direccion').value.trim(),
                correo: document.getElementById('correo').value.trim(),
                usuario: document.getElementById('usuario').value.trim(),
                password: document.getElementById('password').value,
                rolId: parseInt(document.getElementById('rolId').value),
                sedeId: parseInt(document.getElementById('sedeId').value),
                estado: document.getElementById('estado') ? (document.getElementById('estado').checked ? 1 : 0) : 1,
                rolEjecutor: rEjecutor
            };

            if (!datos.rolId || !datos.sedeId) {
                return window.Toast.fire({ icon: 'warning', title: 'DEBE SELECCIONAR ROL Y SEDE' });
            }

            try {
                let res;
                if (this.editandoID) {
                    res = await api.put(`/admin/usuarios/${this.editandoID}`, datos);
                } else {
                    res = await api.post('/admin/usuarios', datos);
                }

                if (res.data.success) {
                    window.Toast.fire({ icon: 'success', title: 'OPERACIÓN EXITOSA' });
                    this.cerrarModal();
                    this.listarUsuarios();
                }
            } catch (error) {
                const msg = error.response?.data?.error || "ERROR DE SERVIDOR";
                window.Toast.fire({ icon: 'error', title: 'ERROR', text: msg.toUpperCase() });
            }
        };
    },

    // 5. PREPARAR EDICION
    async prepararEdicion(u) {
        this.editandoID = u.UsuarioID;
        await this.abrirModal(true);
        
        document.getElementById('modalTitulo').textContent = `EDITANDO: ${u.NombreFull.toUpperCase()}`;
        
        document.getElementById('nombre').value = u.NombreFull || '';
        document.getElementById('cedula').value = u.Cedula || '';
        document.getElementById('telefono').value = u.Telefono || '';
        document.getElementById('direccion').value = u.Direccion || '';
        document.getElementById('correo').value = u.Correo || '';
        document.getElementById('usuario').value = u.Usuario || '';
        
        if (u.RolID) document.getElementById('rolId').value = u.RolID;
        if (u.SedeID) document.getElementById('sedeId').value = u.SedeID;
        
        const passField = document.getElementById('password');
        if (passField) {
            passField.required = false;
            passField.value = ""; 
            passField.placeholder = "DEJAR VACÍO PARA MANTENER ACTUAL";
        }

        const checkEstado = document.getElementById('estado');
        if (checkEstado) {
            checkEstado.checked = (u.Estado == 1 || u.Estado === true);
        }
    },

    // 6. ACTIVACIÓN / DESACTIVACIÓN (LA VARITA MÁGICA)
    async toggleEstadoUsuario(u) {
        const userLogueado = JSON.parse(localStorage.getItem('user')) || {};
        const rEjecutor = userLogueado.rolId || userLogueado.RolID || 0;
        
        const accion = u.Estado ? 'DESACTIVAR' : 'ACTIVAR';
        const nuevoEstado = u.Estado ? 0 : 1;

        const confirm = await Swal.fire({
            title: `¿${accion} USUARIO?`,
            text: u.Estado 
                ? "El colaborador ya no podrá ingresar al sistema." 
                : "El colaborador recuperará el acceso al sistema.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: u.Estado ? '#d33' : '#27ae60',
            confirmButtonText: `SÍ, ${accion}`,
            cancelButtonText: 'CANCELAR'
        });

        if (confirm.isConfirmed) {
            try {
                // Enviamos la actualización de estado al backend
                const res = await api.put(`/admin/usuarios/${u.UsuarioID}`, {
                    nombre: u.NombreFull,
                    cedula: u.Cedula,
                    telefono: u.Telefono,
                    direccion: u.Direccion,
                    correo: u.Correo,
                    usuario: u.Usuario,
                    rolId: u.RolID,
                    sedeId: u.SedeID,
                    estado: nuevoEstado,
                    rolEjecutor: rEjecutor
                });

                if (res.data.success) {
                    window.Toast.fire({ 
                        icon: 'success', 
                        title: `USUARIO ${nuevoEstado ? 'ACTIVADO' : 'DESACTIVADO'} CON ÉXITO` 
                    });
                    this.listarUsuarios();
                }
            } catch (error) {
                const msg = error.response?.data?.error || "ERROR DE PERMISOS";
                window.Toast.fire({ icon: 'error', title: 'ERROR', text: msg.toUpperCase() });
            }
        }
    },

    // ================================================================
    // 7. ROLES Y PERMISOS (por módulo; portado de OmniCore)
    // ================================================================
    _matriz: null,
    _cambios: {},

    tab(cual) {
        const permisos = cual === 'permisos';
        document.getElementById('usPanelPersonal').style.display = permisos ? 'none' : '';
        document.getElementById('usPanelPermisos').style.display = permisos ? '' : 'none';
        document.getElementById('btnNuevoColaborador').style.display = permisos ? 'none' : '';
        document.getElementById('btnNuevoRol').style.display = permisos ? '' : 'none';
        document.getElementById('usTabPersonal').classList.toggle('activo', !permisos);
        document.getElementById('usTabPermisos').classList.toggle('activo', permisos);
        if (permisos) this.cargarMatriz();
    },

    _esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },

    _selNivel(valor, attrs, conHerencia, heredado) {
        const niveles = (this._matriz && this._matriz.niveles) || ['Sin acceso', 'Ver', 'Crear / editar', 'Total'];
        const v = valor === null || valor === undefined ? '' : String(valor);
        const opts = (conHerencia ? [`<option value="" ${v === '' ? 'selected' : ''}>Según su rol (${this._esc(niveles[heredado || 0])})</option>`] : [])
            .concat(niveles.map((n, i) => `<option value="${i}" ${v === String(i) ? 'selected' : ''}>${this._esc(n)}</option>`));
        const clase = v === '' ? `nv${heredado || 0}` : `nv${v}`;
        return `<select class="us-sel ${clase}" ${attrs}>${opts.join('')}</select>`;
    },

    async cargarMatriz() {
        const cont = document.getElementById('usMatriz');
        cont.innerHTML = '<div style="padding:30px; text-align:center; opacity:.6;">Cargando permisos...</div>';
        try {
            const { data } = await api.get('/permisos/matriz');
            this._matriz = data;
            this._cambios = {};
            this.renderMatriz();
        } catch (e) {
            cont.innerHTML = `<div style="padding:30px; text-align:center; color:#c53030;">${this._esc(e.response?.data?.error || 'No se pudieron cargar los permisos.')}</div>`;
        }
    },

    renderMatriz() {
        const { modulos, roles } = this._matriz;
        const grupos = [...new Set(modulos.map(m => m.grupo))];
        const cab = roles.map(r => `<th><div class="us-rol ${r.Activo ? '' : 'inactivo'}">${this._esc(r.NombreRol)}
                <small>${r.Usuarios} usuario(s)${r.Activo ? '' : ' · inactivo'}</small>
                <button class="us-mini" title="Editar el rol" onclick="UsuariosModule.editarRol(${r.RolID})"><i class="fas fa-pen"></i></button>
                <button class="us-mini" title="Todo este rol en..." onclick="UsuariosModule.columnaRol(${r.RolID})"><i class="fas fa-fill-drip"></i></button></div></th>`).join('');
        let filas = '';
        for (const g of grupos) {
            filas += `<tr class="grupo"><td colspan="${roles.length + 1}">${this._esc(g)}</td></tr>`;
            for (const m of modulos.filter(x => x.grupo === g)) {
                filas += `<tr><td class="mod">${this._esc(m.nombre)}</td>${roles.map(r => {
                    const v = (this._cambios[r.RolID] && m.clave in this._cambios[r.RolID]) ? this._cambios[r.RolID][m.clave] : r.permisos[m.clave];
                    const cambiado = this._cambios[r.RolID] && m.clave in this._cambios[r.RolID];
                    return `<td>${this._selNivel(v, `data-rol="${r.RolID}" data-mod="${m.clave}" onchange="UsuariosModule.marcar(this)"`).replace('class="us-sel', `class="us-sel${cambiado ? ' cambiado' : ''}`)}</td>`;
                }).join('')}</tr>`;
            }
        }
        document.getElementById('usMatriz').innerHTML = roles.length
            ? `<table class="us-matriz"><thead><tr><th style="text-align:left;">Módulo</th>${cab}</tr></thead><tbody>${filas}</tbody></table>`
            : '<div style="padding:30px; text-align:center; opacity:.6;">No hay roles fuera del SuperAdmin. Cree uno con NUEVO ROL.</div>';
        this._contarCambios();
    },

    marcar(sel) {
        const rol = parseInt(sel.dataset.rol), mod = sel.dataset.mod, v = parseInt(sel.value);
        const original = this._matriz.roles.find(r => r.RolID === rol).permisos[mod];
        this._cambios[rol] = this._cambios[rol] || {};
        if (v === original) delete this._cambios[rol][mod]; else this._cambios[rol][mod] = v;
        if (!Object.keys(this._cambios[rol]).length) delete this._cambios[rol];
        sel.className = `us-sel nv${v}${v !== original ? ' cambiado' : ''}`;
        this._contarCambios();
    },

    _contarCambios() {
        const n = Object.values(this._cambios).reduce((a, x) => a + Object.keys(x).length, 0);
        document.getElementById('usCambios').textContent = n ? `${n} cambio(s) sin guardar` : '';
    },

    async columnaRol(rolId) {
        const r = this._matriz.roles.find(x => x.RolID === rolId);
        const { value } = await Swal.fire({
            title: `Todo el rol ${r.NombreRol} en...`, input: 'select', showCancelButton: true, confirmButtonText: 'Aplicar (sin guardar aún)',
            inputOptions: Object.fromEntries(this._matriz.niveles.map((n, i) => [i, n])),
        });
        if (value === undefined) return;
        const v = parseInt(value);
        this._cambios[rolId] = this._cambios[rolId] || {};
        this._matriz.modulos.forEach(m => { if (r.permisos[m.clave] !== v) this._cambios[rolId][m.clave] = v; else delete this._cambios[rolId][m.clave]; });
        if (!Object.keys(this._cambios[rolId]).length) delete this._cambios[rolId];
        this.renderMatriz();
    },

    async guardarMatriz() {
        const ids = Object.keys(this._cambios);
        if (!ids.length) return window.Toast.fire({ icon: 'info', title: 'No hay cambios para guardar' });
        const resumen = ids.map(id => {
            const r = this._matriz.roles.find(x => x.RolID === parseInt(id));
            return `<li><b>${this._esc(r.NombreRol)}</b>: ${Object.entries(this._cambios[id]).map(([m, v]) =>
                `${this._esc(this._matriz.modulos.find(x => x.clave === m).nombre)} → ${this._esc(this._matriz.niveles[v])}`).join(', ')}</li>`;
        }).join('');
        const ok = await Swal.fire({ title: '¿Guardar los permisos?', html: `<ul style="text-align:left; font-size:.85rem;">${resumen}</ul>
            <small>Los usuarios conectados verán el cambio en menos de un minuto.</small>`, icon: 'question', showCancelButton: true, confirmButtonText: 'Guardar' });
        if (!ok.isConfirmed) return;
        try {
            for (const id of ids) await api.put(`/permisos/rol/${id}`, { permisos: this._cambios[id] });
            window.Toast.fire({ icon: 'success', title: 'Permisos guardados' });
            await this.cargarMatriz();
        } catch (e) {
            Swal.fire('No se guardó', e.response?.data?.error || 'Error de servidor', 'error');
            await this.cargarMatriz();
        }
    },

    async nuevoRol() {
        const roles = (this._matriz && this._matriz.roles) || [];
        const { value } = await Swal.fire({
            title: 'Nuevo rol',
            html: `<input id="nrNombre" class="swal2-input" placeholder="Nombre (ej. CONTADOR EXTERNO)" maxlength="50">
                   <input id="nrDesc" class="swal2-input" placeholder="Descripción (opcional)" maxlength="200">
                   <select id="nrCopia" class="swal2-select" style="display:flex; margin:1em auto;">
                       <option value="">Empezar sin acceso a nada</option>
                       ${roles.map(r => `<option value="${r.RolID}">Copiar los permisos de ${this._esc(r.NombreRol)}</option>`).join('')}
                   </select>`,
            showCancelButton: true, confirmButtonText: 'Crear rol', focusConfirm: false,
            preConfirm: () => {
                const nombre = document.getElementById('nrNombre').value.trim();
                if (nombre.length < 3) { Swal.showValidationMessage('Escriba un nombre de al menos 3 letras'); return false; }
                return { NombreRol: nombre, Descripcion: document.getElementById('nrDesc').value.trim(), copiarDe: document.getElementById('nrCopia').value || null };
            },
        });
        if (!value) return;
        try {
            await api.post('/permisos/rol', value);
            window.Toast.fire({ icon: 'success', title: `Rol ${value.NombreRol.toUpperCase()} creado` });
            await this.cargarMatriz();
        } catch (e) { Swal.fire('No se creó', e.response?.data?.error || 'Error de servidor', 'error'); }
    },

    async editarRol(rolId) {
        const r = this._matriz.roles.find(x => x.RolID === rolId);
        const { value } = await Swal.fire({
            title: `Rol ${r.NombreRol}`,
            html: `<input id="erNombre" class="swal2-input" value="${this._esc(r.NombreRol)}" maxlength="50">
                   <input id="erDesc" class="swal2-input" value="${this._esc(r.Descripcion)}" placeholder="Descripción" maxlength="200">
                   <label style="display:flex; gap:8px; justify-content:center; align-items:center; margin-top:12px;">
                       <input type="checkbox" id="erActivo" ${r.Activo ? 'checked' : ''}> Rol activo (se puede asignar)</label>`,
            showCancelButton: true, confirmButtonText: 'Guardar', focusConfirm: false,
            preConfirm: () => ({ NombreRol: document.getElementById('erNombre').value.trim(), Descripcion: document.getElementById('erDesc').value.trim(),
                                 Activo: document.getElementById('erActivo').checked }),
        });
        if (!value) return;
        try {
            await api.put(`/permisos/rol/${rolId}`, value);
            window.Toast.fire({ icon: 'success', title: 'Rol actualizado' });
            await this.cargarMatriz();
        } catch (e) { Swal.fire('No se guardó', e.response?.data?.error || 'Error de servidor', 'error'); }
    },

    async permisosUsuario(usuarioId) {
        let d;
        try { d = (await api.get(`/permisos/usuario/${usuarioId}`)).data; }
        catch (e) { return Swal.fire('Permisos', e.response?.data?.error || 'No se pudieron cargar', 'info'); }
        this._matriz = this._matriz || { niveles: d.niveles };
        const grupos = [...new Set(d.modulos.map(m => m.grupo))];
        const filas = grupos.map(g => `<tr class="grupo"><td colspan="2">${this._esc(g)}</td></tr>` + d.modulos.filter(m => m.grupo === g).map(m => {
            const exc = m.clave in d.excepciones ? d.excepciones[m.clave] : null;
            return `<tr><td class="mod">${this._esc(m.nombre)}</td><td>${this._selNivel(exc, `data-mod="${m.clave}" onchange="this.className='us-sel nv'+(this.value===''?'${d.delRol[m.clave] || 0}':this.value)+' cambiado'"`, true, d.delRol[m.clave] || 0)}</td></tr>`;
        }).join('')).join('');
        const r = await Swal.fire({
            title: `Permisos de ${this._esc(d.usuario.NombreFull)}`, width: 720,
            html: `<div style="text-align:left; font-size:.8rem; margin-bottom:10px;">Rol: <b>${this._esc(d.usuario.NombreRol || 'SIN ROL')}</b>.
                   "Según su rol" sigue al rol; cualquier otro valor es una excepción solo para esta persona.</div>
                   <div style="max-height:55vh; overflow:auto;"><table class="us-matriz" id="upTabla">${filas}</table></div>`,
            showCancelButton: true, confirmButtonText: 'Guardar', focusConfirm: false,
            preConfirm: () => {
                const permisos = {};
                document.querySelectorAll('#upTabla select').forEach(s => {
                    const antes = s.dataset.mod in d.excepciones ? String(d.excepciones[s.dataset.mod]) : '';
                    if (s.value !== antes) permisos[s.dataset.mod] = s.value === '' ? null : parseInt(s.value);
                });
                return permisos;
            },
        });
        if (!r.isConfirmed) return;
        if (!Object.keys(r.value).length) return window.Toast.fire({ icon: 'info', title: 'Sin cambios' });
        try {
            await api.put(`/permisos/usuario/${usuarioId}`, { permisos: r.value });
            window.Toast.fire({ icon: 'success', title: 'Permisos de la persona guardados' });
        } catch (e) { Swal.fire('No se guardó', e.response?.data?.error || 'Error de servidor', 'error'); }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    UsuariosModule.init();
});

module.exports = UsuariosModule;