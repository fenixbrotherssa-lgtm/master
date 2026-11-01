// campanas.js — Campañas del CRM por WhatsApp y correo (Fase 6)
// Segmentos (inteligente por recencia/frecuencia, clasificación, cumpleaños, procedencia...),
// vista previa con el porqué de cada descarte, campañas con imagen, avance en vivo,
// automatizaciones (cumpleaños, reactivación, post-estadía), ajustes anti-bloqueo y bajas.
// Solo el administrador (/api/crm/...). El envío lo hace el servidor de uno en uno.
const api = require('./api');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + (parseFloat(n) || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const errMsg = e => (e && e.response && e.response.data && (e.response.data.error || e.response.data.message)) || (e && e.message) || 'Error';
const SEGMENTOS = {
    CAMPEON: ['Campeones', '5+ visitas y vino en los últimos 4 meses', 'b-ok'],
    LEAL: ['Leales', '3+ visitas y vino en los últimos 6 meses', 'b-ok'],
    PROMETEDOR: ['Prometedores', '1–2 visitas, vino en los últimos 2 meses', 'b-azul'],
    EN_RIESGO: ['En riesgo', '3+ visitas pero hace más de 6 meses que no viene', 'b-medio'],
    DORMIDO: ['Dormidos', 'Más de un año sin venir', 'b-alto'],
    OCASIONAL: ['Ocasionales', '1–2 visitas, hace 2 a 12 meses', 'b-gris'],
    PROSPECTO: ['Prospectos', 'Reservó pero aún no se hospedó', 'b-gris'],
};
const CLASIF = { VIP: 'VIP', FRECUENTE: 'Frecuente', REGULAR: 'Regular', NUEVO: 'Nuevo', SIN_ACTIVIDAD: 'Sin actividad' };
const ESTADOS = { PROGRAMADA: ['Programada', 'b-azul'], EN_PROCESO: ['Enviando', 'b-medio'], PAUSADA: ['Pausada', 'b-alto'], COMPLETADA: ['Completada', 'b-ok'], CANCELADA: ['Cancelada', 'b-gris'] };
// estilos en línea: el detalle se abre en un SweetAlert, fuera de #seccion-campanas
const ESTADO_DEST = { PENDIENTE: 'background:#eef0f2;color:#566573', ENVIANDO: 'background:#fdebd0;color:#b9770e', ENVIADO: 'background:#d5f5e3;color:#1e8449',
    FALLIDO: 'background:#fadbd8;color:#b03a2e', OMITIDO: 'background:#eef0f2;color:#566573' };
const BOT = { conectado: ['Conectado', 'b-ok'], esperando_qr: ['Esperando QR', 'b-alto'], iniciando: ['Iniciando', 'b-medio'], reconectando: ['Reconectando', 'b-medio'],
    reiniciando: ['Reiniciando', 'b-medio'], deshabilitado: ['Módulo desactivado', 'b-gris'], detenido: ['Detenido', 'b-gris'], no_disponible: ['No disponible', 'b-gris'], sin_cuenta: ['Sin cuenta', 'b-alto'] };
const AUTO_TIPOS = ['CUMPLEANOS', 'REACTIVACION', 'POST_ESTADIA'];
const AUTO_AYUDA = {
    CUMPLEANOS: 'El día del cumpleaños, a los clientes que aceptaron. Llega aunque hayan recibido otra campaña hace poco.',
    REACTIVACION: 'A quien lleva estos días sin venir (una sola vez por ausencia). Ideal con un descuento.',
    POST_ESTADIA: 'Unos días después de la salida, para agradecer y pedir su opinión. Nunca a estadías por momento.',
};

const CampanasModule = {
    estado: null,
    plantillas: {},
    segmentos: [],
    autos: null,
    img: null,
    _timer: null,
    _ultimaPlantilla: '',

    async init() {
        window.CampanasModule = this;
        window.backView = 'dashboard';
        document.getElementById('cp-rfm').innerHTML = Object.entries(SEGMENTOS)
            .map(([k, [t]]) => `<label><input type="checkbox" data-rfm="${k}"> ${t}</label>`).join('');
        document.getElementById('cp-clasif').innerHTML = Object.entries(CLASIF)
            .map(([k, t]) => `<label><input type="checkbox" data-clasif="${k}"> ${t}</label>`).join('');
        App.renderSedeSelector('sedeSelectorCampanas', () => this.recargar());
        clearInterval(this._timer);
        this._timer = setInterval(() => this.refrescar(), 15000);
        await this.recargar();
    },

    salir() {
        clearInterval(this._timer);
        App.renderView('dashboard', 'viewport');
    },

    getSedeId() {
        const sel = document.getElementById('globalSedeSelector');
        return sel ? sel.value : (localStorage.getItem('currentSedeId') || App.user.SedeID);
    },

    tab(nombre) {
        document.querySelectorAll('#seccion-campanas .cc-tab').forEach(b => b.classList.toggle('activa', b.dataset.tab === nombre));
        document.querySelectorAll('#seccion-campanas .cc-tabpanel').forEach(p => p.style.display = p.dataset.panel === nombre ? '' : 'none');
        if (nombre === 'campanas') this.cargarLista();
        if (nombre === 'nueva') this.vistaPrevia();
        if (nombre === 'clientes') this.cargarClientes();
        if (nombre === 'auto') this.cargarAutos();
        if (nombre === 'ajustes') this.cargarAjustes();
    },

    async recargar() {
        await this.cargarEstado();
        const sede = this.getSedeId();
        try {
            const tipos = (await api.get(`/tarifas/tipos/${sede}`)).data || [];
            document.getElementById('cp-f-tipo').innerHTML = '<option value="">Cualquier habitación</option>' +
                tipos.map(t => `<option value="${t.TipoID}">${esc(t.Descripcion)}</option>`).join('');
        } catch (e) { document.getElementById('cp-f-tipo').innerHTML = '<option value="">Cualquier habitación</option>'; }
        await this.cargarSegmentos();
        if (!document.getElementById('cp-mensaje').value) this.cambioTipo();
        this.cambioCanal();
        const activa = document.querySelector('#seccion-campanas .cc-tab.activa');
        this.tab(activa ? activa.dataset.tab : 'campanas');
    },

    // Cada 15 s mientras la pantalla esté abierta: estado y avance
    async refrescar() {
        if (!document.getElementById('seccion-campanas')) { clearInterval(this._timer); return; }
        await this.cargarEstado();
        const activa = document.querySelector('#seccion-campanas .cc-tab.activa');
        if (activa && activa.dataset.tab === 'campanas') this.cargarLista(true);
    },

    // ---------------- ESTADO ----------------
    async cargarEstado() {
        try {
            const e = this.estado = (await api.get(`/crm/campanas/estado/${this.getSedeId()}`)).data;
            this.plantillas = e.plantillas || {};
            const [lbl, cls] = BOT[e.whatsapp.estado] || [e.whatsapp.estado, 'b-gris'];
            const [lblC, clsC] = BOT[e.correo.estado] || [e.correo.estado, 'b-gris'];
            document.getElementById('cp-estado').innerHTML = `
                <div class="kpi"><div class="t"><i class="fab fa-whatsapp"></i> WhatsApp del hotel</div><div class="v"><span class="badge ${cls}">${lbl}</span></div>
                    <div class="s">${e.whatsapp.estado === 'conectado' ? 'listo para enviar' : 'las campañas esperan a que se conecte'}</div></div>
                <div class="kpi"><div class="t">Enviados hoy (WhatsApp)</div><div class="v">${e.whatsapp.hoy} / ${e.whatsapp.tope}</div>
                    <div class="s">${e.whatsapp.cola} en cola</div></div>
                <div class="kpi"><div class="t"><i class="fas fa-envelope"></i> Correo</div><div class="v"><span class="badge ${clsC}">${lblC}</span></div>
                    <div class="s">hoy ${e.correo.hoy} / ${e.correo.tope} · ${e.correo.cola} en cola</div></div>
                <div class="kpi"><div class="t">Horario de envío</div><div class="v">${esc(e.horario)}</div>
                    <div class="s">${e.enHorario ? 'ahora se puede enviar' : 'fuera de horario: continúa sola'}</div></div>`;
        } catch (e) {
            document.getElementById('cp-estado').innerHTML = `<div class="vacio">${esc(errMsg(e))}</div>`;
        }
    },

    // ---------------- LISTA ----------------
    async cargarLista(silencioso) {
        const el = document.getElementById('cp-lista');
        if (!silencioso) el.innerHTML = '<div class="vacio"><i class="fas fa-spinner fa-spin"></i></div>';
        try {
            const lista = (await api.get(`/crm/campanas/lista/${this.getSedeId()}`)).data;
            if (!lista.length) { el.innerHTML = '<div class="vacio">Todavía no hay campañas. Cree la primera en "Nueva campaña".</div>'; return; }
            el.innerHTML = `<table><thead><tr><th>Campaña</th><th>Estado</th><th>Avance</th><th class="num">Enviados</th><th class="num">Fallidos</th>
                <th class="num">Omitidos</th><th class="num">Respuestas</th><th class="num">Bajas</th><th>Creada</th><th></th></tr></thead><tbody>${lista.map(c => {
                const [lbl, cls] = ESTADOS[c.Estado] || [c.Estado, 'b-gris'];
                const t = c.TotalDestinatarios || 1;
                const w = n => (100 * n / t).toFixed(1) + '%';
                const acciones = [`<button class="cc-btn mini" onclick="CampanasModule.detalle(${c.CampanaID})"><i class="fas fa-eye"></i></button>`];
                if (['EN_PROCESO', 'PROGRAMADA'].includes(c.Estado)) acciones.push(`<button class="cc-btn mini" title="Pausar" onclick="CampanasModule.accion(${c.CampanaID}, 'pausar')"><i class="fas fa-pause"></i></button>`);
                if (c.Estado === 'PAUSADA') acciones.push(`<button class="cc-btn mini ok" title="Reanudar" onclick="CampanasModule.accion(${c.CampanaID}, 'reanudar')"><i class="fas fa-play"></i></button>`);
                if (['EN_PROCESO', 'PROGRAMADA', 'PAUSADA'].includes(c.Estado)) acciones.push(`<button class="cc-btn mini danger" title="Cancelar" onclick="CampanasModule.accion(${c.CampanaID}, 'cancelar')"><i class="fas fa-stop"></i></button>`);
                return `<tr>
                    <td><b>${esc(c.Nombre)}</b><div class="muted">${c.Canal === 'WHATSAPP' ? '<i class="fab fa-whatsapp"></i> WhatsApp' : '<i class="fas fa-envelope"></i> Correo'}
                        ${c.ConImagen ? ' · <i class="fas fa-image"></i>' : ''}${c.Descuento ? ` · ${c.Descuento} %` : ''}${c.Origen === 'AUTOMATICA' ? ' · <i class="fas fa-robot"></i> automática' : ` · ${esc(c.NombreUsuario)}`}</div></td>
                    <td><span class="badge ${cls}">${lbl}</span>${c.Estado === 'PROGRAMADA' ? `<div class="muted">${esc(c.ProgramadaPara)}</div>` : ''}${c.Nota ? `<div class="nota">${esc(c.Nota)}</div>` : ''}</td>
                    <td><div class="progreso" title="${c.Enviados + c.Fallidos + c.Omitidos} de ${c.TotalDestinatarios}"><i style="width:${w(c.Enviados)};background:#27ae60"></i><i style="width:${w(c.Fallidos)};background:#e74c3c"></i><i style="width:${w(c.Omitidos)};background:#bdc3c7"></i></div>
                        <div class="muted">${c.Enviados + c.Fallidos + c.Omitidos} de ${c.TotalDestinatarios}</div></td>
                    <td class="num">${c.Enviados}</td><td class="num">${c.Fallidos}</td><td class="num">${c.Omitidos}</td>
                    <td class="num">${c.Respuestas}</td><td class="num">${c.Bajas ? `<span class="badge ${c.Bajas * 10 >= Math.max(c.Enviados, 1) ? 'b-alto' : 'b-gris'}">${c.Bajas}</span>` : 0}</td>
                    <td class="muted">${esc(c.FechaCreacion)}</td><td style="white-space:nowrap;">${acciones.join(' ')}</td></tr>`;
            }).join('')}</tbody></table>`;
        } catch (e) { if (!silencioso) el.innerHTML = `<div class="vacio">${esc(errMsg(e))}</div>`; }
    },

    async accion(id, accion) {
        const txt = { pausar: '¿Pausar la campaña? Lo pendiente espera hasta que la reanude.', reanudar: '¿Reanudar el envío?',
            cancelar: '¿Cancelar la campaña? Lo que falta no se enviará (no se puede deshacer).' }[accion];
        const ok = await Swal.fire({ title: txt, icon: accion === 'cancelar' ? 'warning' : 'question', showCancelButton: true,
            confirmButtonText: 'Sí', cancelButtonText: 'No', confirmButtonColor: accion === 'cancelar' ? '#e74c3c' : '#1a365d' });
        if (!ok.isConfirmed) return;
        try {
            await api.post(`/crm/campanas/${id}/${accion}`);
            window.Toast && window.Toast.fire({ icon: 'success', title: 'Listo' });
            this.cargarLista(); this.cargarEstado();
        } catch (e) { Swal.fire('No se pudo', errMsg(e), 'error'); }
    },

    async detalle(id) {
        try {
            const d = (await api.get(`/crm/campanas/detalle/${id}`)).data;
            const c = d.campana, r = d.resultados, f = d.fechas;
            const env = c.Enviados || 0;
            const tasa = n => env ? ` (${(100 * n / env).toFixed(1)} %)` : '';
            const filas = d.destinatarios.map(x => `<tr><td>${esc(x.Nombre)}</td><td class="muted">${esc(x.Destino)}</td>
                <td><span style="padding:2px 8px;border-radius:8px;font-size:.66rem;font-weight:800;${ESTADO_DEST[x.Estado]}">${x.Estado}</span>${x.Error ? `<div class="muted">${esc(x.Error)}</div>` : ''}</td>
                <td class="muted">${esc(x.FechaEnvio || '')}</td><td class="muted">${x.FechaRespuesta ? '<i class="fas fa-reply"></i> ' + esc(x.FechaRespuesta) : ''}</td></tr>`).join('');
            await Swal.fire({
                width: 900, title: esc(c.Nombre), confirmButtonText: 'Cerrar', confirmButtonColor: '#1a365d',
                html: `<div style="text-align:left; font-size:.82rem;">
                    <div style="display:grid; grid-template-columns:repeat(5,1fr); gap:8px; margin-bottom:12px;">
                        ${[['Enviados', `${env} de ${c.TotalDestinatarios}`], ['Respuestas', r.Respuestas + tasa(r.Respuestas)], ['Bajas', r.Bajas + tasa(r.Bajas)],
                           ['Volvieron (30 días)', r.ClientesVolvieron + tasa(r.ClientesVolvieron)], ['Ingreso de esas estadías', money(r.IngresoEstadias)]]
                          .map(([t, v]) => `<div style="background:#f4f6f8;border-radius:10px;padding:8px;"><div style="font-size:.62rem;color:#7f8c8d;font-weight:900;text-transform:uppercase;">${t}</div><div style="font-weight:900;color:#1a365d;">${v}</div></div>`).join('')}
                    </div>
                    <div style="color:#7f8c8d; font-size:.72rem; margin-bottom:8px;">Creada ${esc(f.Creada)} por ${esc(c.NombreUsuario)} · inicio ${esc(f.Inicio || '—')} · fin ${esc(f.Fin || '—')}
                        ${c.Nota ? `<br><b style="color:#b9770e;">${esc(c.Nota)}</b>` : ''}</div>
                    <div style="background:#e5ddd5;border-radius:10px;padding:10px;margin-bottom:12px;"><div style="background:#fff;border-radius:8px;padding:8px;white-space:pre-wrap;max-width:420px;">${this._formato(d.ejemplo)}</div></div>
                    <div style="max-height:320px; overflow:auto;"><table style="width:100%; border-collapse:collapse;"><thead><tr style="text-align:left;font-size:.65rem;color:#7f8c8d;">
                        <th>Cliente</th><th>Destino</th><th>Estado</th><th>Envío</th><th>Respuesta</th></tr></thead><tbody>${filas}</tbody></table></div>
                    <div style="color:#7f8c8d; font-size:.68rem; margin-top:8px;">"Volvieron": clientes de la campaña que se hospedaron en esta sede en los 30 días siguientes al mensaje (puede que hubieran venido igual).</div>
                </div>`
            });
        } catch (e) { Swal.fire('Error', errMsg(e), 'error'); }
    },

    // ---------------- NUEVA ----------------
    cambioCanal() {
        const canal = document.getElementById('cp-canal').value;
        document.getElementById('cp-fila-asunto').style.display = canal === 'CORREO' ? '' : 'none';
        document.getElementById('cp-pie-ayuda').innerHTML = canal === 'WHATSAPP'
            ? `Al final se agrega siempre: ${this._formato((this.estado && this.estado.pieWhatsApp) || '_Si no deseas recibir más mensajes, responde SALIR._')}`
            : 'Al final se agrega siempre un enlace para dejar de recibir correos.';
        this.vistaPrevia();
    },

    cambioTipo() {
        const t = document.getElementById('cp-tipo').value;
        const txt = document.getElementById('cp-mensaje');
        if (!txt.value.trim() || txt.value === this._ultimaPlantilla) {
            txt.value = this._ultimaPlantilla = this.plantillas[t] || '';
        }
        if (t === 'CUMPLEANOS') document.getElementById('cp-f-cumple').value = '0';
        this.vistaPrevia();
    },

    insertar(ph) {
        const t = document.getElementById('cp-mensaje');
        const i = t.selectionStart ?? t.value.length;
        t.value = t.value.slice(0, i) + ph + t.value.slice(t.selectionEnd ?? i);
        t.focus(); t.selectionStart = t.selectionEnd = i + ph.length;
        this.vistaPrevia();
    },

    _componer(texto) {
        const desc = document.getElementById('cp-desc').value;
        const hotel = (App.sedeNombre && App.sedeNombre()) || 'su hotel';
        return String(texto || '').replace(/\{nombre\}/gi, 'María').replace(/\{hotel\}/gi, hotel).replace(/\{descuento\}/gi, desc ? `${desc}%` : '').trim();
    },
    // *negrita* y _cursiva_ como en WhatsApp (sobre texto ya escapado)
    _formato(t) {
        return esc(t).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/_([^_\n]+)_/g, '<i>$1</i>');
    },

    vistaPrevia() {
        const canal = document.getElementById('cp-canal').value;
        const msg = document.getElementById('cp-mensaje').value;
        document.getElementById('cp-cuenta').textContent = `(${msg.length}/1500)`;
        const texto = this._componer(msg);
        const img = this.img ? `<img src="${this.img.url}" alt="">` : '';
        const el = document.getElementById('cp-vista');
        if (canal === 'WHATSAPP') {
            const pie = (this.estado && this.estado.pieWhatsApp) || '_Si no deseas recibir más mensajes, responde SALIR._';
            el.innerHTML = `<div class="wa-fondo"><div class="wa-burbuja">${img}<div class="txt">${this._formato(texto + '\n\n' + pie) || '<span class="muted">Escriba el mensaje…</span>'}</div>
                <div class="wa-hora">10:24</div></div></div>`;
        } else {
            const asunto = this._componer(document.getElementById('cp-asunto').value);
            const desc = document.getElementById('cp-desc').value;
            el.innerHTML = `<div style="background:#fff;border-radius:12px;overflow:hidden;font-size:.8rem;">
                <div style="padding:8px 12px;border-bottom:1px solid #eee;"><b>${esc(asunto || '(sin asunto)')}</b></div>
                <div style="background:#1a365d;color:#c5a059;text-align:center;padding:12px;font-weight:900;letter-spacing:2px;text-transform:uppercase;">${esc((App.sedeNombre && App.sedeNombre()) || 'Hotel')}</div>
                ${this.img ? `<img src="${this.img.url}" style="width:100%;display:block;">` : ''}
                <div style="padding:14px;white-space:pre-wrap;color:#2d3748;">${this._formato(texto)}</div>
                ${desc ? `<div style="margin:0 14px 14px;border:1px solid #c5a059;border-radius:8px;text-align:center;padding:10px;font-weight:900;color:#1a365d;">${esc(desc)}% de descuento</div>` : ''}
                <div style="background:#f8f9fa;color:#a0aec0;font-size:.68rem;text-align:center;padding:8px;">No deseo recibir más correos</div></div>`;
        }
    },

    // La imagen se reduce en el navegador (máx. 1280 px, JPEG 0,82) antes de subirla
    cargarImagen(input) {
        const file = input.files && input.files[0];
        if (!file) return;
        if (!/^image\/(jpeg|png)$/.test(file.type)) { Swal.fire('Imagen', 'Use una imagen JPG o PNG.', 'warning'); input.value = ''; return; }
        const lector = new FileReader();
        lector.onload = () => {
            const im = new Image();
            im.onload = () => {
                const k = Math.min(1, 1280 / Math.max(im.width, im.height));
                const cv = document.createElement('canvas');
                cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
                const cx = cv.getContext('2d');
                cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
                cx.drawImage(im, 0, 0, cv.width, cv.height);
                // la vista previa usa data: (la política de contenido de la app no admite blob:)
                const url = cv.toDataURL('image/jpeg', 0.82);
                cv.toBlob(blob => {
                    if (!blob) { Swal.fire('Imagen', 'No se pudo procesar la imagen.', 'error'); return; }
                    this.img = { blob, url };
                    document.getElementById('cp-img-quitar').style.display = '';
                    this.vistaPrevia();
                }, 'image/jpeg', 0.82);
            };
            im.onerror = () => Swal.fire('Imagen', 'El archivo no es una imagen válida.', 'error');
            im.src = lector.result;
        };
        lector.readAsDataURL(file);
    },

    quitarImagen() {
        this.img = null;
        document.getElementById('cp-img').value = '';
        document.getElementById('cp-img-quitar').style.display = 'none';
        this.vistaPrevia();
    },

    filtro() {
        const v = id => document.getElementById(id).value.trim();
        const f = {};
        const rfm = [...document.querySelectorAll('#cp-rfm input:checked')].map(i => i.dataset.rfm);
        const cl = [...document.querySelectorAll('#cp-clasif input:checked')].map(i => i.dataset.clasif);
        if (rfm.length) f.segmentos = rfm;
        if (cl.length) f.clasificaciones = cl;
        for (const [id, k] of [['cp-f-vmin', 'visitasMin'], ['cp-f-gmin', 'gastoMin'], ['cp-f-dmin', 'diasSinVenirMin'], ['cp-f-dmax', 'diasSinVenirMax'],
            ['cp-f-cumple', 'cumpleanosDias'], ['cp-f-tipo', 'tipoHabitacionId']]) if (v(id) !== '') f[k] = parseInt(v(id), 10);
        if (v('cp-f-proc')) f.procedencia = v('cp-f-proc');
        if (document.getElementById('cp-f-mom').checked) f.incluirMomento = true;
        return f;
    },

    ponerFiltro(f = {}) {
        document.querySelectorAll('#cp-rfm input').forEach(i => i.checked = (f.segmentos || []).includes(i.dataset.rfm));
        document.querySelectorAll('#cp-clasif input').forEach(i => i.checked = (f.clasificaciones || []).includes(i.dataset.clasif));
        for (const [id, k] of [['cp-f-vmin', 'visitasMin'], ['cp-f-gmin', 'gastoMin'], ['cp-f-dmin', 'diasSinVenirMin'], ['cp-f-dmax', 'diasSinVenirMax'],
            ['cp-f-cumple', 'cumpleanosDias'], ['cp-f-tipo', 'tipoHabitacionId'], ['cp-f-proc', 'procedencia']]) document.getElementById(id).value = f[k] ?? '';
        document.getElementById('cp-f-mom').checked = !!f.incluirMomento;
    },

    limpiarCriterios() {
        document.getElementById('cp-seg').value = '';
        this.ponerFiltro({});
        document.getElementById('cp-preview').innerHTML = '';
    },

    cambioSegmento() {
        const id = document.getElementById('cp-seg').value;
        const s = this.segmentos.find(x => String(x.SegmentoID) === id);
        this.ponerFiltro(s ? s.filtro : {});
        document.getElementById('cp-preview').innerHTML = '';
    },

    async calcular() {
        const el = document.getElementById('cp-preview');
        el.innerHTML = '<div class="vacio"><i class="fas fa-spinner fa-spin"></i></div>';
        try {
            const p = (await api.post('/crm/campanas/preview', { SedeID: this.getSedeId(), canal: document.getElementById('cp-canal').value,
                tipo: document.getElementById('cp-tipo').value, filtro: this.filtro() })).data;
            this._preview = p;
            const c = p.conteo;
            el.innerHTML = `<div class="kpis" style="margin-top:6px;">
                    <div class="kpi"><div class="t">Recibirán la campaña</div><div class="v" style="color:${p.total ? '#1e8449' : '#b03a2e'}">${p.total}</div>
                        <div class="s">${p.total ? `≈ ${p.diasEstimados} día(s) con el tope de ${p.tope}/día` : 'nadie del segmento puede recibirla'}</div></div>
                    <div class="kpi"><div class="t">En el segmento</div><div class="v">${c.segmento}</div></div></div>
                <ul class="conteo">
                    ${c.sinConsentimiento ? `<li><b>${c.sinConsentimiento}</b> no han aceptado recibir promociones por este canal</li>` : ''}
                    ${c.sinDestino ? `<li><b>${c.sinDestino}</b> sin ${document.getElementById('cp-canal').value === 'WHATSAPP' ? 'celular válido' : 'correo válido'}</li>` : ''}
                    ${c.enBaja ? `<li><b>${c.enBaja}</b> pidieron la baja</li>` : ''}
                    ${c.recientes ? `<li><b>${c.recientes}</b> recibieron otra campaña en los últimos ${p.frecuenciaDias} días</li>` : ''}
                    ${c.duplicados ? `<li><b>${c.duplicados}</b> comparten número/correo con otro cliente (se envía una vez)</li>` : ''}
                    ${p.recortados ? `<li><b>${p.recortados}</b> quedan fuera por el máximo de una campaña; haga otra después</li>` : ''}
                </ul>
                ${p.muestra.length ? `<div class="muted">Ejemplos: ${p.muestra.map(m => `${esc(m.Nombre)} (${esc(m.Destino)})`).join(' · ')}</div>` : ''}`;
        } catch (e) { el.innerHTML = `<div class="vacio">${esc(errMsg(e))}</div>`; }
    },

    async guardarSegmento() {
        const r = await Swal.fire({ title: 'Nombre del segmento', input: 'text', inputPlaceholder: 'Clientes de Quito que no vienen hace 3 meses',
            showCancelButton: true, confirmButtonText: 'Guardar', cancelButtonText: 'Cancelar', confirmButtonColor: '#1a365d' });
        if (!r.isConfirmed) return;
        try {
            await api.post('/crm/segmentos', { SedeID: this.getSedeId(), nombre: r.value, filtro: this.filtro() });
            window.Toast && window.Toast.fire({ icon: 'success', title: 'Segmento guardado' });
            await this.cargarSegmentos();
        } catch (e) { Swal.fire('No se pudo', errMsg(e), 'error'); }
    },

    async crear() {
        const canal = document.getElementById('cp-canal').value;
        const datos = {
            SedeID: this.getSedeId(), canal, tipo: document.getElementById('cp-tipo').value,
            nombre: document.getElementById('cp-nombre').value.trim(), mensaje: document.getElementById('cp-mensaje').value,
            descuento: document.getElementById('cp-desc').value, asunto: document.getElementById('cp-asunto').value,
            programadaPara: document.getElementById('cp-prog').value || '', segmentoId: document.getElementById('cp-seg').value || '',
            filtro: JSON.stringify(this.filtro()),
        };
        if (datos.nombre.length < 3) return Swal.fire('Falta el nombre', 'Ponga un nombre a la campaña (solo lo ve usted).', 'warning');
        let p;
        try {
            p = (await api.post('/crm/campanas/preview', { SedeID: datos.SedeID, canal, tipo: datos.tipo, filtro: this.filtro() })).data;
        } catch (e) { return Swal.fire('Error', errMsg(e), 'error'); }
        if (!p.total) return Swal.fire('Sin destinatarios', 'Nadie del segmento puede recibir esta campaña. Pulse "Calcular destinatarios" para ver por qué.', 'info');
        const ok = await Swal.fire({
            title: '¿Crear la campaña?', icon: 'question', showCancelButton: true, confirmButtonText: 'Sí, crear', cancelButtonText: 'Revisar',
            confirmButtonColor: '#27ae60',
            html: `<b>${p.total}</b> destinatario(s) por <b>${canal === 'WHATSAPP' ? 'WhatsApp' : 'correo'}</b>${this.img ? ' con imagen' : ''}.<br>
                   ${datos.programadaPara ? `Empieza el ${esc(datos.programadaPara.replace('T', ' '))}.` : 'Empieza ahora, dentro del horario de envío.'}<br>
                   <span style="font-size:.85rem;color:#7f8c8d;">Se envía de uno en uno; tardará ≈ ${p.diasEstimados} día(s). Puede pausarla o cancelarla en cualquier momento.</span>`
        });
        if (!ok.isConfirmed) return;
        const fd = new FormData();
        for (const [k, v] of Object.entries(datos)) fd.append(k, v);
        if (this.img) fd.append('imagen', this.img.blob, 'campana.jpg');
        try {
            const r = (await api.post('/crm/campanas', fd)).data;
            Swal.fire({ icon: 'success', title: 'Campaña creada', text: `${r.total} destinatario(s). Puede seguir el avance en "Campañas".`, confirmButtonColor: '#1a365d' });
            document.getElementById('cp-nombre').value = '';
            document.getElementById('cp-prog').value = '';
            this.quitarImagen();
            this.tab('campanas');
            this.cargarEstado();
        } catch (e) { Swal.fire('No se pudo crear', errMsg(e), 'error'); }
    },

    // ---------------- CLIENTES Y SEGMENTOS ----------------
    async cargarSegmentos() {
        try { this.segmentos = (await api.get(`/crm/segmentos/${this.getSedeId()}`)).data; } catch (e) { this.segmentos = []; }
        document.getElementById('cp-seg').innerHTML = '<option value="">— Criterios a mano —</option>' +
            this.segmentos.map(s => `<option value="${s.SegmentoID}">${esc(s.Nombre)}</option>`).join('');
    },

    async cargarClientes() {
        const el = document.getElementById('cp-resumen');
        el.innerHTML = '<div class="vacio"><i class="fas fa-spinner fa-spin"></i></div>';
        try {
            const r = (await api.get(`/crm/resumen/${this.getSedeId()}`)).data;
            const tot = r.segmentos.reduce((a, s) => ({ c: a.c + s.Clientes, w: a.w + s.AceptaWhatsApp, m: a.m + s.AceptaCorreo, n: a.n + s.SinPreguntar }), { c: 0, w: 0, m: 0, n: 0 });
            el.innerHTML = `<table><thead><tr><th>Segmento</th><th>Quiénes son</th><th class="num">Clientes</th><th class="num">Aceptan WhatsApp</th>
                <th class="num">Aceptan correo</th><th class="num">Sin preguntar</th><th class="num">Gastado</th><th></th></tr></thead><tbody>
                ${r.segmentos.map(s => { const [t, d, cls] = SEGMENTOS[s.Segmento] || [s.Segmento, '', 'b-gris']; return `<tr>
                    <td><span class="badge ${cls}">${t}</span></td><td class="muted">${d}</td><td class="num">${s.Clientes}</td>
                    <td class="num">${s.AceptaWhatsApp}</td><td class="num">${s.AceptaCorreo}</td><td class="num">${s.SinPreguntar}</td><td class="num">${money(s.Gastado)}</td>
                    <td><button class="cc-btn mini" onclick="CampanasModule.usarSegmento('${s.Segmento}')"><i class="fas fa-paper-plane"></i> Campaña</button></td></tr>`; }).join('')}
                <tr style="font-weight:900;"><td colspan="2">Total</td><td class="num">${tot.c}</td><td class="num">${tot.w}</td><td class="num">${tot.m}</td><td class="num">${tot.n}</td><td></td><td></td></tr>
                </tbody></table>
                <p class="muted" style="margin-top:8px;">Bajas registradas: WhatsApp ${r.bajas.WHATSAPP || 0} · correo ${r.bajas.CORREO || 0}</p>`;
        } catch (e) { el.innerHTML = `<div class="vacio">${esc(errMsg(e))}</div>`; }
        const sg = document.getElementById('cp-segmentos');
        await this.cargarSegmentos();
        sg.innerHTML = this.segmentos.length ? `<table><thead><tr><th>Nombre</th><th>Criterios</th><th>Creado</th><th></th></tr></thead><tbody>${this.segmentos.map(s => `<tr>
            <td><b>${esc(s.Nombre)}</b></td><td class="muted">${esc(this._describir(s.filtro))}</td><td class="muted">${esc(s.Fecha)} · ${esc(s.NombreUsuario)}</td>
            <td style="white-space:nowrap;"><button class="cc-btn mini" onclick="CampanasModule.usarGuardado(${s.SegmentoID})"><i class="fas fa-paper-plane"></i></button>
            <button class="cc-btn mini danger" onclick="CampanasModule.quitarSegmento(${s.SegmentoID})"><i class="fas fa-trash"></i></button></td></tr>`).join('')}</tbody></table>`
            : '<div class="vacio">Sin segmentos guardados. Arme los criterios en "Nueva campaña" y pulse "Guardar como segmento".</div>';
    },

    _describir(f = {}) {
        const p = [];
        if (f.segmentos) p.push(f.segmentos.map(s => (SEGMENTOS[s] || [s])[0]).join('/'));
        if (f.clasificaciones) p.push(f.clasificaciones.map(c => CLASIF[c] || c).join('/'));
        if (f.visitasMin != null) p.push(`${f.visitasMin}+ visitas`);
        if (f.gastoMin != null) p.push(`gasto ≥ $${f.gastoMin}`);
        if (f.diasSinVenirMin != null) p.push(`sin venir ≥ ${f.diasSinVenirMin} días`);
        if (f.diasSinVenirMax != null) p.push(`vino hace ≤ ${f.diasSinVenirMax} días`);
        if (f.cumpleanosDias != null) p.push(`cumpleaños en ${f.cumpleanosDias} días`);
        if (f.procedencia) p.push(`de "${f.procedencia}"`);
        if (f.tipoHabitacionId) p.push('un tipo de habitación');
        if (f.incluirMomento) p.push('incluye momento');
        return p.join(' · ') || 'todos';
    },

    usarSegmento(seg) {
        this.tab('nueva');
        document.getElementById('cp-seg').value = '';
        this.ponerFiltro({ segmentos: [seg] });
        this.calcular();
    },

    usarGuardado(id) {
        this.tab('nueva');
        document.getElementById('cp-seg').value = String(id);
        this.cambioSegmento();
        this.calcular();
    },

    async quitarSegmento(id) {
        const ok = await Swal.fire({ title: '¿Quitar el segmento?', text: 'Las campañas que lo usaron no cambian.', icon: 'warning', showCancelButton: true,
            confirmButtonText: 'Quitar', cancelButtonText: 'No', confirmButtonColor: '#e74c3c' });
        if (!ok.isConfirmed) return;
        try { await api.delete(`/crm/segmentos/${id}`); this.cargarClientes(); } catch (e) { Swal.fire('Error', errMsg(e), 'error'); }
    },

    // ---------------- AUTOMATIZACIONES ----------------
    async cargarAutos() {
        const el = document.getElementById('cp-autos');
        el.innerHTML = '<div class="vacio"><i class="fas fa-spinner fa-spin"></i></div>';
        try {
            this.autos = (await api.get(`/crm/automatizaciones/${this.getSedeId()}`)).data;
            el.innerHTML = AUTO_TIPOS.map(t => `<div class="cc-panel auto-card" id="cp-auto-${t}"></div>`).join('');
            for (const t of AUTO_TIPOS) {
                const filas = this.autos.automatizaciones.filter(a => a.Tipo === t);
                const a = filas.find(x => x.Activa) || filas.find(x => x.Canal === 'WHATSAPP') || filas[0];
                this.pintarAuto(t, a ? a.Canal : 'WHATSAPP');
            }
        } catch (e) { el.innerHTML = `<div class="vacio">${esc(errMsg(e))}</div>`; }
    },

    pintarAuto(tipo, canal) {
        const A = this.autos;
        const a = A.automatizaciones.find(x => x.Tipo === tipo && x.Canal === canal);
        const otras = A.automatizaciones.filter(x => x.Tipo === tipo && x.Canal !== canal && x.Activa);
        const box = document.getElementById(`cp-auto-${tipo}`);
        box.classList.toggle('on', !!(a && a.Activa));
        const dias = a ? a.Dias : A.diasDefecto[tipo];
        box.innerHTML = `<h3><i class="fas ${tipo === 'CUMPLEANOS' ? 'fa-cake-candles' : tipo === 'REACTIVACION' ? 'fa-rotate-left' : 'fa-heart'}"></i> ${esc(A.nombres[tipo])}
                ${a && a.Activa ? '<span class="badge b-ok">ACTIVA</span>' : '<span class="badge b-gris">INACTIVA</span>'}</h3>
            <p class="ayuda">${AUTO_AYUDA[tipo]}${a ? ` · ${a.Campanas} campaña(s), ${a.Enviados} enviados · última vez ${esc(a.Ultima || 'nunca')}` : ''}
                ${otras.length ? `<br><b>También activa por ${otras.map(o => o.Canal === 'WHATSAPP' ? 'WhatsApp' : 'correo').join(', ')}.</b>` : ''}</p>
            <div class="fila">
                <div class="campo"><label>Canal</label><select onchange="CampanasModule.pintarAuto('${tipo}', this.value)">
                    <option value="WHATSAPP" ${canal === 'WHATSAPP' ? 'selected' : ''}>WhatsApp</option><option value="CORREO" ${canal === 'CORREO' ? 'selected' : ''}>Correo</option></select></div>
                ${tipo === 'CUMPLEANOS' ? '' : `<div class="campo" style="width:150px;"><label>${tipo === 'REACTIVACION' ? 'Días sin venir' : 'Días tras la salida'}</label>
                    <input type="number" data-k="Dias" min="${tipo === 'REACTIVACION' ? 30 : 0}" max="${tipo === 'REACTIVACION' ? 730 : 30}" value="${dias}"></div>`}
                <div class="campo" style="width:120px;"><label>Descuento %</label><input type="number" data-k="Descuento" min="1" max="90" value="${a && a.Descuento ? a.Descuento : ''}"></div>
                ${canal === 'CORREO' ? `<div class="campo" style="flex:1; min-width:220px;"><label>Asunto</label><input type="text" data-k="Asunto" maxlength="200" value="${esc(a && a.Asunto || '')}"></div>` : ''}
                <label style="display:flex; gap:6px; align-items:center; font-weight:800; font-size:.75rem; color:#1a365d;"><input type="checkbox" data-k="Activa" ${a && a.Activa ? 'checked' : ''}> Activa</label>
            </div>
            <div class="campo" style="margin-bottom:10px;"><label>Mensaje ({nombre} {hotel} {descuento})</label>
                <textarea data-k="Mensaje" rows="3" maxlength="1500">${esc(a ? a.Mensaje : A.plantillas[tipo] || '')}</textarea></div>
            <button class="cc-btn ok" onclick="CampanasModule.guardarAuto('${tipo}', '${canal}')"><i class="fas fa-save"></i> Guardar</button>`;
    },

    async guardarAuto(tipo, canal) {
        const box = document.getElementById(`cp-auto-${tipo}`);
        const val = k => { const e = box.querySelector(`[data-k="${k}"]`); return e ? (e.type === 'checkbox' ? e.checked : e.value) : undefined; };
        try {
            await api.put('/crm/automatizaciones', { SedeID: this.getSedeId(), Tipo: tipo, Canal: canal, Activa: val('Activa'), Mensaje: val('Mensaje'),
                Asunto: val('Asunto'), Descuento: val('Descuento'), Dias: val('Dias') });
            window.Toast && window.Toast.fire({ icon: 'success', title: 'Automatización guardada' });
            this.autos = (await api.get(`/crm/automatizaciones/${this.getSedeId()}`)).data;
            this.pintarAuto(tipo, canal);
        } catch (e) { Swal.fire('No se pudo', errMsg(e), 'error'); }
    },

    // ---------------- AJUSTES Y BAJAS ----------------
    _CFG: [['cp-c-tope', 'CRM_WA_TOPE_DIARIO'], ['cp-c-emin', 'CRM_WA_ESPERA_MIN_SEG'], ['cp-c-emax', 'CRM_WA_ESPERA_MAX_SEG'], ['cp-c-lote', 'CRM_WA_LOTE'],
        ['cp-c-plote', 'CRM_WA_PAUSA_LOTE_MIN'], ['cp-c-tcorreo', 'CRM_CORREO_TOPE_DIARIO'], ['cp-c-desde', 'CRM_HORA_DESDE'], ['cp-c-hasta', 'CRM_HORA_HASTA'],
        ['cp-c-frec', 'CRM_FRECUENCIA_DIAS']],

    async cargarAjustes() {
        try {
            const c = (await api.get(`/crm/config-campanas/${this.getSedeId()}`)).data;
            for (const [id, k] of this._CFG) document.getElementById(id).value = c[k];
        } catch (e) { Swal.fire('Error', errMsg(e), 'error'); }
        const el = document.getElementById('cp-bajas');
        try {
            const b = (await api.get('/crm/bajas')).data;
            el.innerHTML = b.length ? `<table><thead><tr><th>Canal</th><th>Número / correo</th><th>Cómo</th><th>Campaña</th><th>Fecha</th></tr></thead><tbody>${b.map(x => `<tr>
                <td>${x.Canal === 'WHATSAPP' ? '<i class="fab fa-whatsapp"></i> WhatsApp' : '<i class="fas fa-envelope"></i> Correo'}</td><td>${esc(x.Destino)}</td>
                <td class="muted">${{ WHATSAPP: 'escribió SALIR', CORREO: 'enlace del correo', CRM: 'registrada a mano' }[x.Origen] || esc(x.Origen)}</td>
                <td class="muted">${esc(x.Campana || '—')}</td><td class="muted">${esc(x.Fecha)}</td></tr>`).join('')}</tbody></table>`
                : '<div class="vacio">Nadie ha pedido la baja.</div>';
        } catch (e) { el.innerHTML = `<div class="vacio">${esc(errMsg(e))}</div>`; }
    },

    async guardarConfig() {
        const config = {};
        for (const [id, k] of this._CFG) config[k] = parseInt(document.getElementById(id).value, 10);
        try {
            await api.put('/crm/config-campanas', { SedeID: this.getSedeId(), config });
            window.Toast && window.Toast.fire({ icon: 'success', title: 'Ajustes guardados' });
            this.cargarEstado();
        } catch (e) { Swal.fire('No se pudo', errMsg(e), 'error'); }
    },
};

module.exports = CampanasModule;
