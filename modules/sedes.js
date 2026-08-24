// C:\SistemasHotel\MasterHotel_App\frontend\modules\sedes.js
const api = require('./api');

const SedesModule = {
    sedes: [],
    map: null,
    marker: null,

    init() {
        console.log("SedesModule: Inicializando infraestructura...");
        this.listarSedes();
        this.setupForm();
        window.SedesModule = this;

        window.actualizarEstadoBot();
        window._botEstadoInterval = setInterval(window.actualizarEstadoBot, 5000);
    },

    async listarSedes() {
        try {
            const res = await api.get('/admin/sedes');
            this.sedes = res.data;
            const body = document.getElementById('tablaSedesBody');
            if (!body) return;

            if (this.sedes.length === 0) {
                body.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; opacity:0.5;">No hay establecimientos registrados</td></tr>`;
                return;
            }

            const serverUrl = api.defaults.baseURL.split('/api')[0];

            body.innerHTML = this.sedes.map(s => {
                const logoRender = s.LogoPath 
                    ? `<img src="${serverUrl}/uploads/${s.LogoPath}" style="width:35px; height:35px; border-radius:6px; object-fit:cover; border:1px solid #1a365d40;" onerror="this.src=''; this.className='fas fa-store';">`
                    : `<i class="fas fa-store" style="color:#718096; font-size: 1.2rem;"></i>`;
                
                const estadoClass = s.Estado ? 'active' : 'inactive';
                const estadoTexto = s.Estado ? 'ACTIVO' : 'INACTIVO';
                
                let regimenTexto = '';
                if (s.RegimenTributario === 'RIMPE_NP') regimenTexto = 'RIMPE NP';
                else if (s.RegimenTributario === 'RIMPE_E') regimenTexto = 'RIMPE EMP';
                
                const rimpeBadge = regimenTexto ? `<span style="font-size:0.6rem; background:#fbbf24; color:#fff; padding:2px 5px; border-radius:4px; margin-left:5px;">${regimenTexto}</span>` : '';

                return `
                <tr>
                    <td style="text-align: center;">${logoRender}</td>
                    <td><strong>${s.RUC_NIT}</strong></td>
                    <td>${s.NombreComercial} ${rimpeBadge}</td>
                    <td>${s.Ciudad || 'N/A'}</td>
                    <td>${s.MonedaSimbolo || '$'} / ${s.ImpuestoPorcentaje}%</td>
                    <td><span class="status-pill ${estadoClass}">${estadoTexto}</span></td>
                    <td style="text-align: center;">
                        <button onclick="SedesModule.editarSede(${s.SedeID})" class="btn-neo" style="padding:8px 12px; display:inline-flex;">
                            <i class="fas fa-edit"></i>
                        </button>
                    </td>
                </tr>`;
            }).join('');
        } catch (error) {
            console.error("Error al listar sedes:", error);
            if (window.Toast) window.Toast.fire({ icon: 'error', title: 'Error de conexión con el servidor' });
        }
    },

    initMap(lat, lng) {
        if (typeof L === 'undefined') {
            console.error("Fallo Crítico: Leaflet no está cargado en el núcleo.");
            return;
        }

        if (this.map) {
            this.map.remove();
            this.map = null;
        }

        const container = document.getElementById('mapContainer');
        if (!container) return;

        const assetPath = 'assets/vendor/leasleft/images/';
        delete L.Icon.Default.prototype._getIconUrl;
        L.Icon.Default.mergeOptions({
            iconRetinaUrl: assetPath + 'marker-icon-2x.png',
            iconUrl: assetPath + 'marker-icon.png',
            shadowUrl: assetPath + 'marker-shadow.png',
        });

        this.map = L.map('mapContainer').setView([lat, lng], 15);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; MasterHotel'
        }).addTo(this.map);

        this.marker = L.marker([lat, lng], { draggable: true }).addTo(this.map);

        const updateCoordsInputs = (latlng) => {
            if(document.getElementById('latitud')) document.getElementById('latitud').value = latlng.lat.toFixed(6);
            if(document.getElementById('longitud')) document.getElementById('longitud').value = latlng.lng.toFixed(6);
        };

        this.marker.on('dragend', (e) => updateCoordsInputs(e.target.getLatLng()));
        
        this.map.on('click', (e) => {
            this.marker.setLatLng(e.latlng);
            updateCoordsInputs(e.latlng);
        });

        setTimeout(() => this.map.invalidateSize(), 200);
    },

    async buscarDireccion() {
        const dir = document.getElementById('direccion').value;
        const ciudad = document.getElementById('ciudad').value;
        if (!dir) return;

        try {
            const query = `${dir}, ${ciudad}, Ecuador`;
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
            const data = await res.json();
            
            if (data.length > 0) {
                const coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
                this.map.setView([coords.lat, coords.lng], 17);
                this.marker.setLatLng([coords.lat, coords.lng]);
                if(document.getElementById('latitud')) document.getElementById('latitud').value = coords.lat.toFixed(6);
                if(document.getElementById('longitud')) document.getElementById('longitud').value = coords.lon.toFixed(6);
            } else {
                if (window.Toast) window.Toast.fire({ icon: 'warning', title: 'Ubicación no encontrada' });
            }
        } catch (e) { 
            console.error("Error en geocodificación:", e); 
        }
    },

    abrirModal(datos = null) {
        const modal = document.getElementById('modalSede');
        const form = document.getElementById('formSede');
        const preview = document.getElementById('logoPreview');
        const placeholder = document.getElementById('logoPlaceholder');
        
        if (!modal || !form) return;

        form.reset();

        let logoActualInput = document.getElementById('logoActualPath');
        if (!logoActualInput) {
            logoActualInput = document.createElement('input');
            logoActualInput.type = 'hidden';
            logoActualInput.id = 'logoActualPath';
            logoActualInput.name = 'LogoActual';
            form.appendChild(logoActualInput);
        }

        if(document.getElementById('sedeId')) document.getElementById('sedeId').value = datos ? datos.SedeID : '';
        if(document.getElementById('modalSedeTitle')) document.getElementById('modalSedeTitle').innerText = datos ? 'MODIFICAR ESTABLECIMIENTO' : 'NUEVO ESTABLECIMIENTO';

        let lat = -0.1807;
        let lng = -78.4678;

        if (datos) {
            if(document.getElementById('ruc_nit')) document.getElementById('ruc_nit').value = datos.RUC_NIT || '';
            if(document.getElementById('nombreComercial')) document.getElementById('nombreComercial').value = datos.NombreComercial || '';
            if(document.getElementById('razonSocial')) document.getElementById('razonSocial').value = datos.RazonSocial || '';
            if(document.getElementById('direccion')) document.getElementById('direccion').value = datos.Direccion || '';
            if(document.getElementById('ciudad')) document.getElementById('ciudad').value = datos.Ciudad || '';
            if(document.getElementById('provincia_estado')) document.getElementById('provincia_estado').value = datos.Provincia_Estado || '';
            if(document.getElementById('region_decimo_cuarto')) document.getElementById('region_decimo_cuarto').value = datos.RegionDecimoCuarto || '';
            if(document.getElementById('telefono')) document.getElementById('telefono').value = datos.Telefono || '';
            if(document.getElementById('emailContacto')) document.getElementById('emailContacto').value = datos.EmailContacto || '';
            if(document.getElementById('impuestoPorcentaje')) document.getElementById('impuestoPorcentaje').value = datos.ImpuestoPorcentaje || 0;
            if(document.getElementById('estadoSede')) document.getElementById('estadoSede').value = datos.Estado ? "1" : "0";
            if(document.getElementById('monedaSimbolo')) document.getElementById('monedaSimbolo').value = datos.MonedaSimbolo || '$';
            if(document.getElementById('website')) document.getElementById('website').value = datos.Website || '';
            
            if(document.getElementById('regimenTributario')) document.getElementById('regimenTributario').value = datos.RegimenTributario || 'GENERAL';
            if(document.getElementById('agenteRetencion')) document.getElementById('agenteRetencion').value = datos.AgenteRetencion || '';
            if(document.getElementById('contribuyenteEspecial')) document.getElementById('contribuyenteEspecial').value = datos.ContribuyenteEspecial || '';
            if(document.getElementById('obligadoContabilidad')) document.getElementById('obligadoContabilidad').value = datos.ObligadoContabilidad ? "1" : "0";
            
            logoActualInput.value = datos.LogoPath || '';

            if (datos.Latitud && datos.Longitud) {
                lat = parseFloat(datos.Latitud);
                lng = parseFloat(datos.Longitud);
                if(document.getElementById('latitud')) document.getElementById('latitud').value = lat;
                if(document.getElementById('longitud')) document.getElementById('longitud').value = lng;
            }

            if (preview && placeholder) {
                if (datos.LogoPath) {
                    const serverUrl = api.defaults.baseURL.split('/api')[0];
                    preview.src = `${serverUrl}/uploads/${datos.LogoPath}`;
                    preview.style.display = 'block';
                    placeholder.style.display = 'none';
                } else {
                    preview.src = '';
                    preview.style.display = 'none';
                    placeholder.style.display = 'block';
                }
            }
        } else {
            logoActualInput.value = '';
            if(document.getElementById('regimenTributario')) document.getElementById('regimenTributario').value = 'GENERAL';
            if(document.getElementById('agenteRetencion')) document.getElementById('agenteRetencion').value = '';
            if(document.getElementById('contribuyenteEspecial')) document.getElementById('contribuyenteEspecial').value = '';
            if(document.getElementById('obligadoContabilidad')) document.getElementById('obligadoContabilidad').value = '0';

            if (preview && placeholder) {
                preview.src = '';
                preview.style.display = 'none';
                placeholder.style.display = 'block';
            }
        }

        modal.classList.remove('hidden');
        setTimeout(() => this.initMap(lat, lng), 300);
    },

    cerrarModal() { 
        document.getElementById('modalSede').classList.add('hidden'); 
    },

    setupForm() {
        const form = document.getElementById('formSede');
        if (!form) return;

        form.onsubmit = async (e) => {
            e.preventDefault();
            
            const user = JSON.parse(localStorage.getItem('user'));
            const formData = new FormData(form);
            
            const rolID = user?.RolID || user?.rolId || 0;
            formData.append('rolEjecutor', parseInt(rolID));
            
            if(document.getElementById('estadoSede')) formData.set('Estado', document.getElementById('estadoSede').value === "1" ? 1 : 0);
            if(document.getElementById('regimenTributario')) formData.set('RegimenTributario', document.getElementById('regimenTributario').value);
            if(document.getElementById('obligadoContabilidad')) formData.set('ObligadoContabilidad', document.getElementById('obligadoContabilidad').value === "1" ? 1 : 0);

            try {
                // La instancia de axios fija 'Content-Type: application/json' por defecto,
                // lo cual bloquea la autodetección de FormData. Hay que forzar multipart aquí.
                const res = await api.post('/admin/sedes', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });
                
                if (res.data.success) {
                    this.cerrarModal();
                    this.listarSedes();
                    if (window.Toast) window.Toast.fire({ icon: 'success', title: 'CONFIGURACIÓN SINCRONIZADA' });
                }
            } catch (err) { 
                console.error("Fallo al guardar sede:", err);
                const msg = err.response?.data?.error || 'Error al procesar la solicitud';
                if (window.Toast) window.Toast.fire({ icon: 'error', title: msg });
            }
        };
    },

    editarSede(id) {
        const sede = this.sedes.find(s => s.SedeID === id);
        if (sede) this.abrirModal(sede);
    },

    handleLogoChange(input) {
        if (input.files && input.files[0]) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const preview = document.getElementById('logoPreview');
                const placeholder = document.getElementById('logoPlaceholder');
                if (preview && placeholder) {
                    preview.src = e.target.result;
                    preview.style.display = 'block';
                    placeholder.style.display = 'none';
                }
            };
            reader.readAsDataURL(input.files[0]);
        }
    },

    // Sugiere la región del Décimo Cuarto según la provincia escrita — el admin
    // puede corregirlo manualmente, esto es solo una ayuda (no se auto-guarda).
    sugerirRegionDecimoCuarto() {
        const provincia = (document.getElementById('provincia_estado')?.value || '').trim().toLowerCase();
        const sel = document.getElementById('region_decimo_cuarto');
        if (!provincia || !sel || sel.value) return; // no pisar una elección manual ya hecha

        const costaGalapagos = ['guayas', 'manabí', 'manabi', 'los ríos', 'los rios', 'el oro', 'esmeraldas', 'santa elena', 'santo domingo', 'galápagos', 'galapagos'];
        const sierraAmazonia = ['pichincha', 'azuay', 'loja', 'tungurahua', 'chimborazo', 'cotopaxi', 'imbabura', 'carchi', 'cañar', 'canar', 'bolívar', 'bolivar',
            'sucumbíos', 'sucumbios', 'napo', 'orellana', 'pastaza', 'morona santiago', 'zamora chinchipe'];

        if (costaGalapagos.some(p => provincia.includes(p))) sel.value = 'COSTA';
        else if (sierraAmazonia.some(p => provincia.includes(p))) sel.value = 'SIERRA';
    }
};

// --- ESTADO Y REINICIO DEL BOT DE WHATSAPP ---
// Vive acá (módulo externo, cargado una sola vez al navegar a esta vista)
// y no en un <script> inline dentro de views/sedes.html, porque
// App.renderView() inserta las vistas vía innerHTML — los navegadores
// nunca ejecutan <script> insertados así.
const BOT_ESTADOS = {
    conectado:      { texto: 'Conectado',                dot: 'verde' },
    iniciando:      { texto: 'Iniciando...',             dot: 'amarillo' },
    reiniciando:    { texto: 'Reiniciando...',           dot: 'amarillo' },
    reconectando:   { texto: 'Reconectando...',          dot: 'amarillo' },
    esperando_qr:   { texto: 'Requiere escanear QR',      dot: 'rojo' }
};

window.actualizarEstadoBot = async function () {
    const txtEl = document.getElementById('bot-estado-texto');
    const dbEl = document.getElementById('bot-db-texto');
    const qrCard = document.getElementById('bot-qr-card');
    const qrImg = document.getElementById('bot-qr-img');
    if (!txtEl || !dbEl) {
        clearInterval(window._botEstadoInterval);
        return;
    }

    try {
        const resp = (await api.get('/whatsapp/estado')).data;
        if (resp.status !== 'OK') return; // error puntual, se reintenta en el próximo ciclo

        const info = BOT_ESTADOS[resp.estadoBot] || { texto: resp.estadoBot, dot: 'gris' };
        txtEl.innerHTML = `<span class="bot-dot bot-dot-${info.dot}"></span> ${info.texto}`;
        dbEl.innerHTML = resp.dbOk
            ? '<i class="fas fa-check-circle" style="color:#22c55e"></i> Base de datos OK'
            : '<i class="fas fa-times-circle" style="color:#ef4444"></i> Base de datos sin respuesta';

        if (resp.estadoBot === 'esperando_qr' && resp.qr && qrCard && qrImg) {
            qrImg.src = resp.qr;
            qrCard.style.display = 'flex';
        } else if (qrCard) {
            qrCard.style.display = 'none';
        }
    } catch (e) { /* error de red puntual, se reintenta en el próximo ciclo */ }
};

window.reiniciarBotWhatsapp = function () {
    Swal.fire({
        title: '¿Reiniciar el bot de WhatsApp?',
        text: 'Se cerrará y volverá a abrir la sesión. Tarda unos segundos y solo hace falta si el bot dejó de responder.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, reiniciar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#1a365d'
    }).then((result) => {
        if (!result.isConfirmed) return;

        const btn = document.getElementById('btn-reiniciar-bot');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Reiniciando...'; }

        api.post('/whatsapp/reiniciar', {}).then(res => {
            if (res.data.status !== 'OK') {
                Swal.fire('Error', res.data.message || 'No se pudo reiniciar el bot.', 'error');
            }
        }).catch(e => {
            Swal.fire('Error', e.response?.data?.message || e.message, 'error');
        }).finally(() => {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-rotate-right"></i> Reiniciar Bot'; }
            window.actualizarEstadoBot();
        });
    });
};

module.exports = SedesModule;