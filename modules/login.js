const LoginModule = {
    init() {
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