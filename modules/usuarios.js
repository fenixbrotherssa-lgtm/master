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
    }
};

document.addEventListener('DOMContentLoaded', () => {
    UsuariosModule.init();
});

module.exports = UsuariosModule;