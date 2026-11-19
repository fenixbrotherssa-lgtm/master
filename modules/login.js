const LoginModule = {
    init() {
        const li = document.getElementById('login-idioma');
        if (li && window.Idioma) li.innerHTML = Idioma.botonHTML('background:#e0e5ea; color:#007bff; border:none; padding:10px 16px; border-radius:15px; cursor:pointer; font-size:.85rem; font-weight:800; box-shadow: 6px 6px 12px #9eaab6, -6px -6px 12px #ffffff;');
        // Servidor del sistema: se elige una vez desde aqui y queda guardado en el equipo (modules/servidor.js)
        if (window.Servidor && Servidor.disponible()) {
            Servidor.pintarEnLogin(document.getElementById('login-servidor'));
            Servidor.revisarAlInicio();
        }
        const btn = document.getElementById('btn-login-submit');
        const userField = document.getElementById('login-usuario');
        const passField = document.getElementById('login-password');
        
        if (btn) {
            btn.onclick = (e) => {
                e.preventDefault();
                this.autenticar();
            };
        }

        // Soporte para tecla Enter
        [userField, passField].forEach(input => {
            if (!input) return;
            input.onkeypress = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.autenticar();
                }
            };
        });
    },

    async autenticar() {
        const usuarioInput = document.getElementById('login-usuario');
        const passwordInput = document.getElementById('login-password');
        const btn = document.getElementById('btn-login-submit');

        const usuario = usuarioInput.value.trim();
        const password = passwordInput.value.trim();

        if (!usuario || !password) {
            window.Toast.fire({
                icon: 'warning',
                title: 'CAMPOS VACIOS',
                text: 'Por favor, ingrese sus credenciales.'
            });
            return;
        }

        try {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> VERIFICANDO...';
            btn.style.opacity = "0.7";

            const response = await api.post('/auth/login', { usuario, password });

            if (response.data && response.data.token) {
                // GUARDAR SESIÓN
                localStorage.setItem('token', response.data.token);
                localStorage.setItem('refreshToken', response.data.refreshToken);
                localStorage.setItem('user', JSON.stringify(response.data.user));
                localStorage.removeItem('permisos'); // los del usuario anterior no valen
                
                // ÉXITO TOTAL
                if (window.Alertas) {
                    window.Alertas.notificar('exito', `Bienvenido, ${response.data.user.NombreFull}`);
                }
                await window.Toast.fire({
                    icon: 'success',
                    title: 'ACCESO CONCEDIDO',
                    text: `Bienvenido, ${response.data.user.NombreFull}`,
                    timer: 1500,
                    showConfirmButton: false
                });

                // Cargar el Shell del sistema (detecta entorno: escritorio o móvil)
                if (typeof App !== 'undefined' && App.renderShell) {
                    // Escritorio (Electron)
                    App.user = response.data.user;
                    App.renderShell();
                } else if (typeof AppMobile !== 'undefined') {
                    // Móvil (Capacitor): refresca usuario y enruta por rol
                    AppMobile.user = response.data.user;
                    AppMobile.conectarSocket();
                    AppMobile.routeByRole();
                }
            }

        } catch (err) {
            btn.disabled = false;
            btn.innerText = "INGRESAR";
            btn.style.opacity = "1";

            // Sin respuesta del servidor: ofrecer revisar/cambiar a que servidor apunta este equipo
            if (!err.response && window.Servidor && Servidor.disponible()) {
                const st = await Servidor.estado().catch(() => null);
                const r = await Swal.fire({ icon: 'error', title: 'Sin conexión con el servidor',
                    html: 'No se pudo conectar con <b>' + String((st && st.apiUrl) || '').replace(/[<>&]/g, '') + '</b>.<br>Revise que el servidor esté encendido y en la misma red.',
                    showCancelButton: true, confirmButtonText: '<i class="fas fa-server"></i> CAMBIAR SERVIDOR', cancelButtonText: 'Reintentar' });
                if (r.isConfirmed) Servidor.configurar();
                return;
            }
            
            const msg = err.response?.data?.message || "ERROR DE CONEXION AL SERVIDOR";
            
            window.Toast.fire({
                icon: 'error',
                title: 'ERROR DE ACCESO',
                text: msg.toUpperCase(),
                confirmButtonText: 'REINTENTAR'
            });
        }
    }
};

module.exports = LoginModule;