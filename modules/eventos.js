// eventos.js — Eventos y salones (Fase 7): calendario semanal por salón, lista, cotización con
// salones + menú del inventario + servicios (totales, costo y margen en vivo), detalle con cobros
// (anticipo/saldo a la caja abierta, centro EVE), confirmar, realizar (descarga el menú del
// inventario), cancelar, devolver y proforma en PDF. Lectura para todos; escribir: administrador
// (cobrar: cualquiera con su caja abierta). API: /api/eventos/...
const api = require('./api');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => n == null || !isFinite(n) ? '—' : '$' + Number(n).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const errMsg = e => (e && e.response && e.response.data && (e.response.data.error || e.response.data.message)) || (e && e.message) || 'Error';
const r2 = n => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const fh = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}` : '';
const horas = (a, b) => (Date.parse(`${b}:00Z`) - Date.parse(`${a}:00Z`)) / 3600000;
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const ESTADOS = { COTIZACION: ['Cotización', 'b-medio'], CONFIRMADO: ['Confirmado', 'b-azul'], REALIZADO: ['Realizado', 'b-ok'], CANCELADO: ['Cancelado', 'b-gris'] };
const TIPOS = { SOCIAL: 'Social', BODA: 'Boda', CORPORATIVO: 'Corporativo', CONFERENCIA: 'Conferencia', CUMPLEANOS: 'Cumpleaños', GRADUACION: 'Graduación', OTRO: 'Otro' };
const MONTAJES = { BANQUETE: 'Banquete', TEATRO: 'Teatro', ESCUELA: 'Escuela', COCTEL: 'Cóctel', U: 'En U', OTRO: 'Otro' };
const TARIFAS = { HORA: 'Por hora', MEDIO_DIA: 'Medio día', DIA: 'Día', FIJO: 'Precio fijo' };
const TIPOS_ITEM = { MENU: 'Menú', BEBIDA: 'Bebida', SERVICIO: 'Servicio', HABITACION: 'Habitaciones', OTRO: 'Otro' };
const opts = (o, sel) => Object.entries(o).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');

const EventosModule = {
    salones: [],
    productos: [],
    lunes: null,
    ed: null,
    actual: null,

    async init() {
        window.EventosModule = this;
        window.backView = 'dashboard';
        this.admin = require('./permisos').puede('eventos', 3);   // permiso "Total" en Eventos (cotizar, confirmar, realizar...)
        if (!this.admin) document.querySelectorAll('#seccion-eventos .solo-admin').forEach(e => e.style.display = 'none');
        this.lunes = this.lunesDe(new Date());
        App.renderSedeSelector('sedeSelectorEventos', () => this.recargar());
        await this.recargar();
    },

    getSedeId() {
        const sel = document.getElementById('globalSedeSelector');
        return sel ? sel.value : (localStorage.getItem('currentSedeId') || App.user.SedeID);
    },

    lunesDe(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; },

    async recargar() {
        const s = this.getSedeId();
        try {
            const [sal, prod] = await Promise.all([api.get(`/eventos/salones/${s}`), api.get(`/eventos/productos/${s}`)]);
            this.salones = sal.data; this.productos = prod.data;
        } catch (e) { this.salones = []; this.productos = []; }
        this.cargarResumen();
        this.tab(this._tab || 'calendario');
    },

    tab(nombre) {
        this._tab = nombre;
        document.querySelectorAll('#seccion-eventos .cc-tab').forEach(b => b.classList.toggle('activa', b.dataset.tab === nombre));
        document.querySelectorAll('#seccion-eventos .cc-tabpanel').forEach(p => p.style.display = p.dataset.panel === nombre ? '' : 'none');
        if (nombre === 'calendario') this.cargarCalendario();
        if (nombre === 'lista') this.cargarLista();
        if (nombre === 'salones') this.pintarSalones();
    },

    async cargarResumen() {
        try {
            const { data: r } = await api.get(`/eventos/resumen/${this.getSedeId()}`);
            const k = (t, v, s) => `<div class="kpi"><div class="t">${t}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
            document.getElementById('ev-kpis').innerHTML = k('Cotizaciones vigentes', r.Cotizaciones, money(r.ValorCotizado)) + k('Confirmados por venir', r.Confirmados)
                + k('Por cobrar', money(r.PorCobrar)) + k('Ventas del mes', money(r.VentasMes), 'confirmados y realizados')
                + k('Conversión 90 días', r.Conversion == null ? '—' : `${r.Conversion.toFixed(0)}%`, `${r.Ganados90} de ${r.Creados90} cotizaciones`)
                + (r.PorRealizar ? k('<span style="color:#b03a2e">Sin marcar realizados</span>', r.PorRealizar, 'ya terminaron') : '');
        } catch (_) { document.getElementById('ev-kpis').innerHTML = ''; }
    },

    // ---------------------------------------------------------------- calendario
    semana(delta) {
        if (delta === 0) this.lunes = this.lunesDe(new Date());
        else this.lunes.setDate(this.lunes.getDate() + 7 * delta);
        this.cargarCalendario();
    },

    async cargarCalendario() {
        const dias = Array.from({ length: 7 }, (_, i) => { const d = new Date(this.lunes); d.setDate(d.getDate() + i); return iso(d); });
        document.getElementById('ev-semana').textContent = `${fh(dias[0] + 'T00:00').slice(0, 10)} al ${fh(dias[6] + 'T00:00').slice(0, 10)}`;
        const cont = document.getElementById('ev-cal');
        const salones = this.salones.filter(s => s.Activo);
        if (!salones.length) { cont.innerHTML = `<div class="vacio">No hay salones. ${this.admin ? 'Créelos en la pestaña Salones.' : ''}</div>`; return; }
        let bloques = [];
        try { bloques = (await api.get(`/eventos/calendario/${this.getSedeId()}`, { params: { desde: dias[0], hasta: dias[6] } })).data; } catch (_) { /* */ }
        const hoy = iso(new Date());
        cont.innerHTML = `<table class="cal"><thead><tr><th></th>${dias.map((d, i) => `<th class="${d === hoy ? 'hoy' : ''}">${DIAS[i]} ${d.slice(8)}</th>`).join('')}</tr></thead><tbody>
            ${salones.map(s => `<tr><td class="salon">${esc(s.Nombre)}</td>${dias.map(d => {
                const del = bloques.filter(b => b.SalonID === s.SalonID && b.Inicio.slice(0, 10) <= d && b.Fin.slice(0, 10) >= d);
                return `<td onclick="EventosModule.clicCelda(event, ${s.SalonID}, '${d}')">${del.map(b => `<span class="chip ${b.Estado}" title="${esc(b.Codigo)} · ${esc(b.Nombre)} · ${b.Asistentes} pers. · ${esc(b.Contacto)}"
                    onclick="event.stopPropagation(); EventosModule.detalle(${b.EventoID})">${b.Inicio.slice(0, 10) === d ? b.Inicio.slice(11, 16) : '…'}–${b.Fin.slice(0, 10) === d ? b.Fin.slice(11, 16) : '…'} ${esc(b.Nombre)}</span>`).join('')}</td>`;
            }).join('')}</tr>`).join('')}</tbody></table>`;
    },

    clicCelda(ev, salonId, dia) {
        if (!this.admin) return;
        this.nuevo({ salones: [{ SalonID: salonId, Inicio: `${dia}T10:00`, Fin: `${dia}T14:00`, Montaje: 'BANQUETE', Tarifa: 'HORA', Precio: 0 }] });
    },

    // ---------------------------------------------------------------- lista
    async cargarLista() {
        const cont = document.getElementById('ev-lista');
        cont.innerHTML = '<div class="vacio"><i class="fas fa-spinner fa-spin"></i></div>';
        try {
            const { data } = await api.get(`/eventos/lista/${this.getSedeId()}`, { params: {
                estado: document.getElementById('ev-f-estado').value || undefined, buscar: document.getElementById('ev-f-buscar').value || undefined,
                proximos: document.getElementById('ev-f-prox').checked ? 1 : undefined } });
            cont.innerHTML = data.length ? `<table><thead><tr><th>Código</th><th>Fecha</th><th>Evento</th><th>Cliente</th><th>Salones</th><th class="num">Pers.</th>
                <th class="num">Total</th><th class="num">Saldo</th><th class="num">Margen</th><th>Estado</th></tr></thead><tbody>
                ${data.map(e => { const costo = e.CostoReal != null ? e.CostoReal : e.CostoEstimado; const m = e.Total ? (e.Total - costo) * 100 / e.Total : null;
                    return `<tr class="click" onclick="EventosModule.detalle(${e.EventoID})"><td><b>${esc(e.Codigo)}</b></td><td>${fh(e.FechaInicio)}</td>
                    <td>${esc(e.Nombre)}<br><span class="muted">${TIPOS[e.Tipo] || e.Tipo}</span></td><td>${esc(e.Contacto)}${e.Empresa ? `<br><span class="muted">${esc(e.Empresa)}</span>` : ''}</td>
                    <td class="muted">${esc(e.Salones || '')}</td><td class="num">${e.Asistentes}</td><td class="num">${money(e.Total)}</td>
                    <td class="num" style="${e.Saldo > 0.009 && e.Estado !== 'CANCELADO' ? 'color:#b03a2e;font-weight:800;' : ''}">${money(e.Saldo)}</td>
                    <td class="num">${m == null ? '—' : m.toFixed(0) + '%'}</td>
                    <td><span class="badge ${ESTADOS[e.Estado][1]}">${ESTADOS[e.Estado][0]}</span>${e.Vencida ? ' <span class="badge b-alto">Vencida</span>' : ''}</td></tr>`; }).join('')}
                </tbody></table>` : '<div class="vacio">No hay eventos con ese filtro.</div>';
        } catch (e) { cont.innerHTML = `<div class="vacio">${esc(errMsg(e))}</div>`; }
    },

    // ---------------------------------------------------------------- editor
    nuevo(base = {}) {
        if (!this.admin) return;
        const vence = new Date(); vence.setDate(vence.getDate() + 15);
        this.cargarEditor({ EventoID: null, Nombre: '', Tipo: 'SOCIAL', Asistentes: '', Contacto: '', Empresa: '', Documento: '', Telefono: '', Correo: '', DescuentoPct: 0,
            Notas: '', Condiciones: 'Anticipo del 50 % para confirmar la fecha. Saldo hasta 3 días antes del evento.', VenceCotizacion: iso(vence),
            salones: base.salones || [{ SalonID: (this.salones.find(s => s.Activo) || {}).SalonID, Inicio: '', Fin: '', Montaje: 'BANQUETE', Tarifa: 'HORA', Precio: 0 }], items: [] });
    },

    cargarEditor(e) {
        this.ed = { id: e.EventoID, codigo: e.Codigo };
        const set = (id, v) => { document.getElementById(id).value = v ?? ''; };
        document.getElementById('ev-ed-titulo').textContent = e.EventoID ? `Editar ${e.Codigo}` : 'Nueva cotización';
        set('ev-nombre', e.Nombre); set('ev-tipo', e.Tipo); set('ev-asist', e.Asistentes); set('ev-contacto', e.Contacto); set('ev-empresa', e.Empresa);
        set('ev-doc', e.Documento); set('ev-tel', e.Telefono); set('ev-correo', e.Correo); set('ev-desc', e.DescuentoPct || ''); set('ev-notas', e.Notas);
        set('ev-cond', e.Condiciones); set('ev-vence', e.VenceCotizacion);
        document.getElementById('ev-bloques').innerHTML = '';
        document.getElementById('ev-items').innerHTML = '';
        document.getElementById('ev-avisos').innerHTML = '';
        (e.salones || []).forEach(b => this.agregarBloque(b));
        (e.items || []).forEach(i => this.agregarItem(i));
        this.tab('editor');
        document.querySelectorAll('#seccion-eventos .cc-tab').forEach(b => b.classList.toggle('activa', b.dataset.tab === 'editor'));
        this.recalcular();
    },

    agregarBloque(b = {}) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td><select data-k="SalonID" onchange="EventosModule.recalcular()">${this.salones.filter(s => s.Activo || s.SalonID === b.SalonID)
                .map(s => `<option value="${s.SalonID}" ${s.SalonID === b.SalonID ? 'selected' : ''}>${esc(s.Nombre)}</option>`).join('')}</select></td>
            <td><input type="datetime-local" data-k="Inicio" value="${b.Inicio || ''}" onchange="EventosModule.recalcular()"></td>
            <td><input type="datetime-local" data-k="Fin" value="${b.Fin || ''}" onchange="EventosModule.recalcular()"></td>
            <td><select data-k="Montaje" onchange="EventosModule.recalcular()">${opts(MONTAJES, b.Montaje || 'BANQUETE')}</select></td>
            <td><select data-k="Tarifa" onchange="EventosModule.recalcular()">${opts(TARIFAS, b.Tarifa || 'HORA')}</select></td>
            <td><input type="number" data-k="Precio" min="0" step="0.01" value="${b.Precio || 0}" oninput="EventosModule.recalcular()" class="num"></td>
            <td><button class="x" onclick="this.closest('tr').remove(); EventosModule.recalcular()"><i class="fas fa-trash"></i></button></td>`;
        document.getElementById('ev-bloques').appendChild(tr);
        this.recalcular();
    },

    agregarItem(i = {}) {
        const tr = document.createElement('tr');
        const opProd = '<option value="">— Sin producto (servicio externo) —</option>' + this.productos
            .map(p => `<option value="${p.ProductoID}" ${p.ProductoID === i.ProductoID ? 'selected' : ''}>${esc(p.Nombre)}${p.TieneReceta ? ' (receta)' : ''}</option>`).join('');
        tr.innerHTML = `<td><select data-k="Tipo">${opts(TIPOS_ITEM, i.Tipo || 'MENU')}</select></td>
            <td><select data-k="ProductoID" onchange="EventosModule.cambioProducto(this)">${opProd}</select>
                <input data-k="Descripcion" maxlength="200" placeholder="Descripción" value="${esc(i.Descripcion || '')}" style="margin-top:4px;"></td>
            <td><input data-k="Momento" maxlength="60" placeholder="Almuerzo 13:00" value="${esc(i.Momento || '')}"></td>
            <td><input type="number" data-k="Cantidad" min="0" step="0.001" value="${i.Cantidad ?? 1}" oninput="EventosModule.recalcular()" class="num"></td>
            <td><input type="number" data-k="PrecioUnitario" min="0" step="0.01" value="${i.PrecioUnitario ?? 0}" oninput="EventosModule.recalcular()" class="num"></td>
            <td><input type="number" data-k="CostoUnitarioEst" min="0" step="0.0001" value="${i.CostoUnitarioEst ?? 0}" oninput="EventosModule.recalcular()" class="num" ${i.ProductoID ? 'readonly title="Costo real del inventario"' : ''}></td>
            <td class="num" data-sub>$0.00</td>
            <td><button class="x" onclick="this.closest('tr').remove(); EventosModule.recalcular()"><i class="fas fa-trash"></i></button></td>`;
        document.getElementById('ev-items').appendChild(tr);
        this.recalcular();
    },

    cambioProducto(sel) {
        const tr = sel.closest('tr');
        const p = this.productos.find(x => String(x.ProductoID) === sel.value);
        const costo = tr.querySelector('[data-k=CostoUnitarioEst]');
        if (p) {
            tr.querySelector('[data-k=Descripcion]').value = p.Nombre;
            tr.querySelector('[data-k=PrecioUnitario]').value = p.PrecioVenta;
            costo.value = Number(p.Costo).toFixed(4); costo.readOnly = true; costo.title = 'Costo real del inventario';
            tr.querySelector('[data-k=Tipo]').value = /BEBIDA/i.test(p.Categoria) ? 'BEBIDA' : 'MENU';
        } else { costo.readOnly = false; costo.title = ''; }
        this.recalcular();
    },

    leerFilas(tbody) {
        return [...document.getElementById(tbody).querySelectorAll('tr')].map(tr => {
            const o = {}; tr.querySelectorAll('[data-k]').forEach(x => { o[x.dataset.k] = x.value; }); return o;
        });
    },

    precioBloque(b) {
        const s = this.salones.find(x => String(x.SalonID) === String(b.SalonID));
        const h = b.Inicio && b.Fin ? horas(b.Inicio, b.Fin) : 0;
        if (!s || !(h > 0)) return b.Tarifa === 'FIJO' ? r2(b.Precio) : 0;
        if (b.Tarifa === 'HORA') return r2(h * s.PrecioHora);
        if (b.Tarifa === 'MEDIO_DIA') return r2(s.PrecioMedioDia * Math.max(1, Math.ceil(h / 5)));
        if (b.Tarifa === 'DIA') return r2(s.PrecioDia * Math.max(1, Math.ceil(h / 24)));
        return r2(b.Precio);
    },

    recalcular() {
        if (!document.getElementById('ev-bloques')) return;
        let sal = 0;
        document.querySelectorAll('#ev-bloques tr').forEach(tr => {
            const b = {}; tr.querySelectorAll('[data-k]').forEach(x => { b[x.dataset.k] = x.value; });
            const p = this.precioBloque(b);
            const inp = tr.querySelector('[data-k=Precio]');
            if (b.Tarifa !== 'FIJO') { inp.value = p.toFixed(2); inp.readOnly = true; } else inp.readOnly = false;
            sal += p;
        });
        let items = 0, costo = 0;
        document.querySelectorAll('#ev-items tr').forEach(tr => {
            const q = Number(tr.querySelector('[data-k=Cantidad]').value) || 0, pu = Number(tr.querySelector('[data-k=PrecioUnitario]').value) || 0;
            const cu = Number(tr.querySelector('[data-k=CostoUnitarioEst]').value) || 0;
            tr.querySelector('[data-sub]').textContent = money(q * pu);
            items += r2(q * pu); costo += q * cu;
        });
        const desc = Math.min(100, Math.max(0, Number(document.getElementById('ev-desc').value) || 0));
        const sub = r2(sal + items), total = r2(sub * (1 - desc / 100));
        const asis = parseInt(document.getElementById('ev-asist').value, 10) || 0;
        document.getElementById('ev-t-sal').textContent = money(sal);
        document.getElementById('ev-t-items').textContent = money(items);
        document.getElementById('ev-t-desc').textContent = desc ? '−' + money(sub - total) : '$0.00';
        document.getElementById('ev-t-total').textContent = money(total);
        document.getElementById('ev-t-costo').textContent = money(costo);
        const m = total ? (total - costo) * 100 / total : null;
        document.getElementById('ev-t-margen').innerHTML = m == null ? '—' : `<span style="color:${m < 30 ? '#b03a2e' : '#1e8449'}">${money(total - costo)} (${m.toFixed(0)}%)</span>`;
        document.getElementById('ev-t-pp').textContent = asis ? money(total / asis) : '—';
    },

    async guardar() {
        const v = id => document.getElementById(id).value;
        const body = { SedeID: this.getSedeId(), Nombre: v('ev-nombre'), Tipo: v('ev-tipo'), Asistentes: v('ev-asist'), Contacto: v('ev-contacto'), Empresa: v('ev-empresa'),
            Documento: v('ev-doc'), Telefono: v('ev-tel'), Correo: v('ev-correo'), DescuentoPct: v('ev-desc') || 0, Notas: v('ev-notas'), Condiciones: v('ev-cond'),
            VenceCotizacion: v('ev-vence'),
            salones: this.leerFilas('ev-bloques').map(b => ({ ...b, SalonID: parseInt(b.SalonID, 10), Precio: Number(b.Precio) || 0 })),
            items: this.leerFilas('ev-items').map(i => ({ ...i, ProductoID: i.ProductoID ? parseInt(i.ProductoID, 10) : null, Cantidad: Number(i.Cantidad), PrecioUnitario: Number(i.PrecioUnitario), CostoUnitarioEst: Number(i.CostoUnitarioEst) })) };
        try {
            const { data } = this.ed.id ? await api.put(`/eventos/evento/${this.ed.id}`, body) : await api.post('/eventos/evento', body);
            if (data.avisos && data.avisos.length) await Swal.fire({ icon: 'warning', title: `Guardado ${data.codigo || ''}`, html: `<ul style="text-align:left;font-size:.85rem;">${data.avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul>`, confirmButtonColor: '#1a365d' });
            else Swal.fire({ icon: 'success', title: 'Guardado', toast: true, position: 'top-end', timer: 1800, showConfirmButton: false });
            this.cargarResumen();
            this.detalle(data.eventoId);
        } catch (e) { Swal.fire({ icon: 'error', title: 'No se guardó', text: errMsg(e), confirmButtonColor: '#1a365d' }); }
    },

    // ---------------------------------------------------------------- detalle
    async detalle(id) {
        if (this._tab !== 'detalle') this._volver = this._tab === 'editor' ? 'lista' : (this._tab || 'lista');
        const cont = document.getElementById('ev-detalle');
        document.querySelectorAll('#seccion-eventos .cc-tab').forEach(b => b.classList.remove('activa'));
        document.querySelectorAll('#seccion-eventos .cc-tabpanel').forEach(p => p.style.display = p.dataset.panel === 'detalle' ? '' : 'none');
        this._tab = 'detalle';
        cont.innerHTML = '<div class="cc-panel"><div class="vacio"><i class="fas fa-spinner fa-spin"></i></div></div>';
        try {
            const { data: e } = await api.get(`/eventos/detalle/${id}`, { params: { sedeId: this.getSedeId() } });
            this.actual = e;
            const costo = e.CostoReal != null ? e.CostoReal : e.CostoEstimado;
            const vivo = e.Estado === 'COTIZACION' || e.Estado === 'CONFIRMADO';
            const btn = (cond, html) => cond ? html : '';
            const acciones = [
                btn(this.admin && vivo, `<button class="cc-btn" onclick="EventosModule.editar()"><i class="fas fa-pen"></i> Editar</button>`),
                btn(this.admin && e.Estado === 'COTIZACION', `<button class="cc-btn primary" onclick="EventosModule.confirmar()"><i class="fas fa-check"></i> Confirmar</button>`),
                btn(e.Estado !== 'CANCELADO' && e.Saldo > 0.009, `<button class="cc-btn ok" onclick="EventosModule.cobrar()"><i class="fas fa-cash-register"></i> Cobrar</button>`),
                btn(this.admin && e.Estado === 'CONFIRMADO' && e.YaEmpezo, `<button class="cc-btn oro" onclick="EventosModule.realizar()"><i class="fas fa-flag-checkered"></i> Marcar realizado</button>`),
                btn(this.admin && e.Estado === 'REALIZADO', `<button class="cc-btn" onclick="EventosModule.revertir()"><i class="fas fa-rotate-left"></i> Deshacer realizado</button>`),
                `<button class="cc-btn" onclick="EventosModule.proforma()"><i class="fas fa-file-pdf"></i> ${e.Estado === 'COTIZACION' ? 'Cotización' : 'Orden'} PDF</button>`,
                btn(this.admin && e.Pagado > 0.009, `<button class="cc-btn" onclick="EventosModule.devolver()"><i class="fas fa-hand-holding-dollar"></i> Devolver</button>`),
                btn(this.admin && vivo, `<button class="cc-btn danger" onclick="EventosModule.cancelar()"><i class="fas fa-ban"></i> Cancelar evento</button>`),
            ].join('');
            const hist = [`Creado ${esc(e.CreadoTxt)} por ${esc(e.NombreUsuario || '')}`, e.ConfirmadoTxt && `Confirmado ${esc(e.ConfirmadoTxt)}`, e.RealizadoTxt && `Realizado ${esc(e.RealizadoTxt)}${e.SinDescarga ? ' (sin descontar inventario)' : ''}`,
                e.CanceladoTxt && `Cancelado ${esc(e.CanceladoTxt)}: ${esc(e.MotivoCancelacion)}`].filter(Boolean).join(' · ');
            cont.innerHTML = `
                <div class="cc-panel">
                    <div class="barra" style="margin-bottom:6px;">
                        <button class="cc-btn mini" onclick="EventosModule.tab('${this._volver || 'lista'}')"><i class="fas fa-arrow-left"></i></button>
                        <h3 style="margin:0;"><i class="fas fa-champagne-glasses"></i> ${esc(e.Codigo)} · ${esc(e.Nombre)}</h3>
                        <span class="badge ${ESTADOS[e.Estado][1]}">${ESTADOS[e.Estado][0]}</span>
                    </div>
                    <p class="ayuda">${TIPOS[e.Tipo] || e.Tipo} · ${fh(e.FechaInicio)} a ${fh(e.FechaFin)} · ${e.Asistentes} personas · ${esc(e.Contacto)}${e.Empresa ? ` (${esc(e.Empresa)})` : ''}
                        ${e.Telefono ? ` · ${esc(e.Telefono)}` : ''}${e.Correo ? ` · ${esc(e.Correo)}` : ''}<br><span class="muted">${hist}</span></p>
                    <div class="kpis">
                        <div class="kpi"><div class="t">Total</div><div class="v">${money(e.Total)}</div><div class="s">${e.DescuentoPct ? `con ${e.DescuentoPct}% de descuento` : ''}</div></div>
                        <div class="kpi"><div class="t">Pagado</div><div class="v">${money(e.Pagado)}</div></div>
                        <div class="kpi"><div class="t">Saldo</div><div class="v" style="color:${e.Saldo > 0.009 ? '#b03a2e' : '#1e8449'}">${money(e.Saldo)}</div></div>
                        <div class="kpi"><div class="t">${e.CostoReal != null ? 'Costo real' : 'Costo estimado'}</div><div class="v">${money(costo)}</div></div>
                        <div class="kpi"><div class="t">Margen</div><div class="v">${money(e.Margen)}</div><div class="s">${e.MargenPct == null ? '' : e.MargenPct.toFixed(1) + '%'}</div></div>
                        <div class="kpi"><div class="t">Por persona</div><div class="v">${e.Asistentes ? money(e.Total / e.Asistentes) : '—'}</div></div>
                    </div>
                    <div class="barra">${acciones}</div>
                </div>
                <div class="grid2">
                    <div>
                        <div class="cc-panel"><h3><i class="fas fa-door-open"></i> Salones</h3>
                            <table><thead><tr><th>Salón</th><th>Desde</th><th>Hasta</th><th>Montaje</th><th>Tarifa</th><th class="num">Valor</th></tr></thead><tbody>
                            ${e.salones.map(s => `<tr><td>${esc(s.Salon)}</td><td>${fh(s.Inicio)}</td><td>${fh(s.Fin)}</td><td>${MONTAJES[s.Montaje] || s.Montaje}</td><td>${TARIFAS[s.Tarifa] || s.Tarifa}</td><td class="num">${money(s.Precio)}</td></tr>`).join('')}
                            </tbody></table></div>
                        <div class="cc-panel"><h3><i class="fas fa-utensils"></i> Menú y servicios</h3>
                            ${e.items.length ? `<table><thead><tr><th>Ítem</th><th>Momento</th><th class="num">Cant.</th><th class="num">P. unit.</th><th class="num">Valor</th><th class="num">Costo</th></tr></thead><tbody>
                            ${e.items.map(i => `<tr><td>${esc(i.Descripcion)} <span class="muted">${TIPOS_ITEM[i.Tipo] || ''}${i.ProductoID ? ' · inventario' : ''}</span></td><td>${esc(i.Momento || '')}</td>
                                <td class="num">${Number(i.Cantidad)}</td><td class="num">${money(i.PrecioUnitario)}</td><td class="num">${money(i.Subtotal)}</td><td class="num muted">${money(i.Cantidad * i.CostoUnitarioEst)}</td></tr>`).join('')}
                            </tbody></table>` : '<div class="vacio">Sin ítems.</div>'}</div>
                        ${e.consumo.length ? `<div class="cc-panel"><h3><i class="fas fa-boxes-stacked"></i> Salió del inventario</h3><table><thead><tr><th>Producto</th><th class="num">Cantidad</th><th class="num">Costo</th></tr></thead><tbody>
                            ${e.consumo.map(c => `<tr><td>${esc(c.Nombre)}</td><td class="num">${window.Unidades ? Unidades.fmt(c.Cantidad, c.UnidadBase) : c.Cantidad + ' ' + (c.UnidadBase || '')}</td><td class="num">${money(c.Costo)}</td></tr>`).join('')}
                            </tbody></table></div>` : ''}
                    </div>
                    <div>
                        <div class="cc-panel"><h3><i class="fas fa-receipt"></i> Pagos</h3>
                            ${e.pagos.length ? `<table><tbody>${e.pagos.map(p => `<tr><td>${esc(p.Fecha)}<br><span class="muted">${esc(p.Metodo)} · ${esc(p.Destino)}${p.Referencia ? ' · ' + esc(p.Referencia) : ''}</span></td>
                                <td><span class="badge ${p.Tipo === 'DEVOLUCION' ? 'b-alto' : 'b-ok'}">${p.Tipo}</span></td><td class="num">${p.Tipo === 'DEVOLUCION' ? '−' : ''}${money(p.Monto)}</td></tr>`).join('')}</tbody></table>`
                                : '<div class="vacio">Sin pagos.</div>'}
                            <p class="muted" style="margin-top:8px;">Para anular un pago, anule su movimiento en Caja/Finanzas: el pago del evento se revierte solo.</p></div>
                        ${e.Notas ? `<div class="cc-panel"><h3><i class="fas fa-clipboard-list"></i> Requerimientos</h3><p style="white-space:pre-wrap;font-size:.8rem;margin:0;">${esc(e.Notas)}</p></div>` : ''}
                        ${e.Condiciones ? `<div class="cc-panel"><h3><i class="fas fa-scale-balanced"></i> Condiciones</h3><p style="white-space:pre-wrap;font-size:.8rem;margin:0;">${esc(e.Condiciones)}</p></div>` : ''}
                    </div>
                </div>`;
        } catch (err) { cont.innerHTML = `<div class="cc-panel"><div class="vacio">${esc(errMsg(err))}</div></div>`; }
    },

    editar() { const e = this.actual; this.cargarEditor({ ...e, salones: e.salones, items: e.items }); },

    async accion(url, body, ok) {
        try {
            const { data } = await api.post(url, { SedeID: this.getSedeId(), ...body });
            if (ok) await ok(data);
            this.cargarResumen();
            this.detalle(this.actual.EventoID);
            return data;
        } catch (e) {
            if (e.response && e.response.data && e.response.data.stockInsuficiente) return e.response.data;
            Swal.fire({ icon: 'error', title: 'No se pudo', text: errMsg(e), confirmButtonColor: '#1a365d' });
            return null;
        }
    },

    async confirmar() {
        const ok = await Swal.fire({ title: `¿Confirmar ${this.actual.Codigo}?`, text: 'El salón queda reservado en ese horario. Ningún otro evento podrá confirmarse encima.', icon: 'question',
            showCancelButton: true, confirmButtonText: 'Confirmar', cancelButtonText: 'Volver', confirmButtonColor: '#1a365d' });
        if (!ok.isConfirmed) return;
        await this.accion(`/eventos/evento/${this.actual.EventoID}/confirmar`, {}, d => d.sinAnticipo
            ? Swal.fire({ icon: 'info', title: 'Confirmado', text: 'Aún no tiene anticipo: regístrelo con "Cobrar".', confirmButtonColor: '#1a365d' }) : null);
    },

    async cobrar(tipo) {
        const e = this.actual, devolucion = tipo === 'DEVOLUCION';
        const metodos = (window.MetodosPago && await MetodosPago.listar(this.getSedeId())) || [{ MetodoID: 1, Nombre: 'Efectivo', Grupo: 'EFECTIVO' }];
        const { value, isConfirmed } = await Swal.fire({
            title: devolucion ? `Devolver dinero — ${e.Codigo}` : `Cobrar — ${e.Codigo}`,
            html: `<div style="text-align:left;font-size:.85rem;">
                ${devolucion ? `<p>Pagado: <b>${money(e.Pagado)}</b>. Sale como egreso de caja.</p>` : `<p>Saldo: <b>${money(e.Saldo)}</b>. Entra a su caja abierta${this.admin ? ' (sin caja: a Finanzas)' : ''}, centro Eventos.</p>
                <label>Tipo</label><select id="sw-tipo" class="swal2-select" style="width:100%;margin:4px 0 10px;"><option value="ANTICIPO">Anticipo</option><option value="SALDO" ${e.Pagado > 0 ? 'selected' : ''}>Saldo</option></select>`}
                <label>Monto</label><input id="sw-monto" type="number" step="0.01" min="0.01" class="swal2-input" style="width:100%;margin:4px 0 10px;" value="${devolucion ? '' : e.Saldo.toFixed(2)}">
                <label>Método</label><select id="sw-metodo" class="swal2-select" style="width:100%;margin:4px 0 10px;">${metodos.map(m => `<option value="${m.MetodoID}" data-g="${m.Grupo}">${esc(m.Nombre)}</option>`).join('')}</select>
                <label>Comprobante / referencia</label><input id="sw-ref" class="swal2-input" style="width:100%;margin:4px 0;" maxlength="100" placeholder="Obligatorio si no es efectivo"></div>`,
            showCancelButton: true, confirmButtonText: devolucion ? 'Registrar devolución' : 'Cobrar', cancelButtonText: 'Volver', confirmButtonColor: devolucion ? '#e74c3c' : '#27ae60',
            preConfirm: () => ({ Tipo: devolucion ? 'DEVOLUCION' : document.getElementById('sw-tipo').value, Monto: Number(document.getElementById('sw-monto').value),
                MetodoID: parseInt(document.getElementById('sw-metodo').value, 10), Referencia: document.getElementById('sw-ref').value }),
        });
        if (!isConfirmed) return;
        await this.accion(`/eventos/evento/${e.EventoID}/pago`, value, d => Swal.fire({ icon: 'success', title: devolucion ? 'Devolución registrada' : 'Cobrado', text: `Registrado en ${d.destino}.`, timer: 2200, showConfirmButton: false }));
    },

    devolver() { return this.cobrar('DEVOLUCION'); },

    async realizar() {
        const e = this.actual;
        const ok = await Swal.fire({ title: `¿Marcar ${e.Codigo} como realizado?`, html: `<p style="font-size:.85rem;">El menú y las bebidas del inventario salen de bodega ahora y el evento queda con su costo real.${e.Saldo > 0.009 ? `<br><b style="color:#b03a2e;">Tiene saldo pendiente de ${money(e.Saldo)}.</b>` : ''}</p>`,
            icon: 'question', showCancelButton: true, confirmButtonText: 'Sí, realizado', cancelButtonText: 'Volver', confirmButtonColor: '#c5a059' });
        if (!ok.isConfirmed) return;
        const r = await this.accion(`/eventos/evento/${e.EventoID}/realizar`, {}, d => Swal.fire({ icon: 'success', title: 'Evento realizado', text: `Costo real ${money(d.costoReal)}.`, confirmButtonColor: '#1a365d' }));
        if (r && r.stockInsuficiente) {
            const { value: motivo, isConfirmed } = await Swal.fire({ icon: 'warning', title: 'Falta inventario', html: `<p style="font-size:.85rem;">${esc(r.error)}</p>
                <p style="font-size:.8rem;">Lo correcto es registrar la compra en Cocina y Costos y volver a intentar. Si el menú no salió de la bodega (lo trajo el cliente, se compró aparte…), puede marcarlo realizado <b>sin descontar inventario</b> explicando el motivo.</p>`,
                input: 'textarea', inputPlaceholder: 'Motivo (mínimo 10 caracteres)', showCancelButton: true, confirmButtonText: 'Realizar sin descontar', cancelButtonText: 'Volver', confirmButtonColor: '#e67e22',
                inputValidator: v => String(v || '').trim().length < 10 ? 'Escriba al menos 10 caracteres.' : undefined });
            if (isConfirmed) await this.accion(`/eventos/evento/${e.EventoID}/realizar`, { sinDescarga: true, motivo });
        }
    },

    async revertir() {
        const { value: motivo, isConfirmed } = await Swal.fire({ title: 'Deshacer "realizado"', text: 'Lo que salió del inventario vuelve a bodega al mismo costo y el evento queda confirmado.',
            input: 'textarea', showCancelButton: true, confirmButtonText: 'Deshacer', cancelButtonText: 'Volver', confirmButtonColor: '#e74c3c',
            inputValidator: v => String(v || '').trim().length < 10 ? 'Escriba el motivo (mínimo 10 caracteres).' : undefined });
        if (isConfirmed) await this.accion(`/eventos/evento/${this.actual.EventoID}/revertir`, { motivo });
    },

    async cancelar() {
        const e = this.actual;
        const { value: motivo, isConfirmed } = await Swal.fire({ title: `Cancelar ${e.Codigo}`, html: `<p style="font-size:.85rem;">El salón queda libre.${e.Pagado > 0.009 ? ` Tiene <b>${money(e.Pagado)}</b> pagados: si corresponde devolver, use "Devolver" después.` : ''}</p>`,
            input: 'textarea', inputPlaceholder: 'Motivo', showCancelButton: true, confirmButtonText: 'Cancelar evento', cancelButtonText: 'Volver', confirmButtonColor: '#e74c3c',
            inputValidator: v => String(v || '').trim().length < 5 ? 'Escriba el motivo.' : undefined });
        if (isConfirmed) await this.accion(`/eventos/evento/${e.EventoID}/cancelar`, { motivo });
    },

    async proforma() {
        const e = this.actual;
        try {
            const res = await api.get(`/eventos/proforma/${e.EventoID}`, { params: { sedeId: this.getSedeId() }, responseType: 'arraybuffer' });
            const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
            const a = document.createElement('a'); a.href = url; a.download = `${e.Codigo}.pdf`; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        } catch (err) { Swal.fire({ icon: 'error', title: 'No se generó el PDF', text: errMsg(err), confirmButtonColor: '#1a365d' }); }
    },

    // ---------------------------------------------------------------- salones
    pintarSalones() {
        const cont = document.getElementById('ev-salones');
        cont.innerHTML = this.salones.length ? `<table><thead><tr><th>Salón</th><th class="num">Banquete</th><th class="num">Teatro</th><th class="num">Hora</th><th class="num">Medio día</th><th class="num">Día</th><th>Próximos</th><th></th></tr></thead><tbody>
            ${this.salones.map(s => `<tr${s.Activo ? '' : ' style="opacity:.5"'}><td><b>${esc(s.Nombre)}</b>${s.AreaM2 ? ` <span class="muted">${s.AreaM2} m²</span>` : ''}${s.Descripcion ? `<br><span class="muted">${esc(s.Descripcion)}</span>` : ''}</td>
                <td class="num">${s.CapBanquete || '—'}</td><td class="num">${s.CapTeatro || '—'}</td><td class="num">${money(s.PrecioHora)}</td><td class="num">${money(s.PrecioMedioDia)}</td>
                <td class="num">${money(s.PrecioDia)}</td><td>${s.EventosProximos || 0}</td>
                <td>${this.admin ? `<button class="cc-btn mini" onclick="EventosModule.editarSalon(${s.SalonID})"><i class="fas fa-pen"></i></button>` : ''}</td></tr>`).join('')}
            </tbody></table>` : '<div class="vacio">Aún no hay salones.</div>';
    },

    editarSalon(id) {
        const s = this.salones.find(x => x.SalonID === id); if (!s) return;
        const set = (k, v) => { document.getElementById(k).value = v ?? ''; };
        document.getElementById('sl-titulo').textContent = `Editar ${s.Nombre}`;
        set('sl-id', s.SalonID); set('sl-nombre', s.Nombre); set('sl-desc', s.Descripcion); set('sl-area', s.AreaM2); set('sl-orden', s.Orden);
        set('sl-ct', s.CapTeatro); set('sl-cb', s.CapBanquete); set('sl-ce', s.CapEscuela); set('sl-cc', s.CapCoctel); set('sl-cu', s.CapU);
        set('sl-ph', s.PrecioHora); set('sl-pm', s.PrecioMedioDia); set('sl-pd', s.PrecioDia);
        document.getElementById('sl-activo').checked = !!s.Activo;
    },

    limpiarSalon() {
        document.getElementById('sl-titulo').textContent = 'Nuevo salón';
        ['sl-id', 'sl-nombre', 'sl-desc', 'sl-area', 'sl-ct', 'sl-cb', 'sl-ce', 'sl-cc', 'sl-cu', 'sl-ph', 'sl-pm', 'sl-pd'].forEach(k => { document.getElementById(k).value = ''; });
        document.getElementById('sl-orden').value = 0; document.getElementById('sl-activo').checked = true;
    },

    async guardarSalon() {
        const v = k => document.getElementById(k).value;
        try {
            await api.post('/eventos/salon', { SedeID: this.getSedeId(), SalonID: v('sl-id') || null, Nombre: v('sl-nombre'), Descripcion: v('sl-desc'), AreaM2: v('sl-area'),
                Orden: v('sl-orden'), Activo: document.getElementById('sl-activo').checked, CapTeatro: v('sl-ct'), CapBanquete: v('sl-cb'), CapEscuela: v('sl-ce'),
                CapCoctel: v('sl-cc'), CapU: v('sl-cu'), PrecioHora: v('sl-ph'), PrecioMedioDia: v('sl-pm'), PrecioDia: v('sl-pd') });
            this.salones = (await api.get(`/eventos/salones/${this.getSedeId()}`)).data;
            this.limpiarSalon(); this.pintarSalones();
            Swal.fire({ icon: 'success', title: 'Salón guardado', toast: true, position: 'top-end', timer: 1800, showConfirmButton: false });
        } catch (e) { Swal.fire({ icon: 'error', title: 'No se guardó', text: errMsg(e), confirmButtonColor: '#1a365d' }); }
    },
};

module.exports = EventosModule;
