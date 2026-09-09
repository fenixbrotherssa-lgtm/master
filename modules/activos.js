const api = require('./api');

/**
 * CARGA DINÁMICA DE LIBRERÍA QR VÍA HTTP
 * Se consume directamente desde el servidor Express local.
 */
function loadQRCodeLib() {
    return new Promise(async (resolve) => {
        if (window.QRCode) return resolve(); 
        
        try {
            const baseUrl = api.defaults.baseURL.replace('/api', '');
            const scriptUrl = `${baseUrl}/assets/js/qrcode.min.js`;

            const response = await fetch(scriptUrl);
            if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
            
            const scriptContent = await response.text();
            
            const script = document.createElement('script');
            script.id = 'qr-lib';
            script.textContent = scriptContent; 
            
            document.head.appendChild(script);
            console.log("✅ QR Lib inyectada exitosamente desde el servidor local");
            resolve();
        } catch (error) {
            console.error("❌ Error al inyectar QR Lib vía fetch. Usando fallback...", error);
            const baseUrl = api.defaults.baseURL.replace('/api', '');
            const scriptFallback = document.createElement('script');
            scriptFallback.src = `${baseUrl}/assets/js/qrcode.min.js`;
            scriptFallback.onload = resolve;
            scriptFallback.onerror = () => {
                console.error("Fallo crítico: No se pudo cargar qrcode.min.js.");
                resolve();
            };
            document.head.appendChild(scriptFallback);
        }
    });
}

const ActivosModule = {
    activosCache: [],
    tiposCache: [],
    metodosPagoCache: [],
    sedeActualInfo: null,
    modoActual: 'REGISTRO',
    state: {
        busqueda: '',
        tipo: 'TODOS',
        estado: 'TODOS',
        incluirBajas: false
    },

    async init() {
        console.log("ActivosModule: Inicializado correctamente");
        
        window.backView = 'inventario'; 
        if (typeof Router !== 'undefined') Router.showBack(false);

        const container = document.getElementById('seccion-activos');
        if (container) container.style.display = 'block';

        window.ActivosModule = this;
        this.renderSedeSelector();

        await loadQRCodeLib();
        await this.cargarTipos();
        if (App.isSuperAdmin()) {
            this.cargarMetodosPago();
            const btnDep = document.getElementById('btn-depreciacion');
            if (btnDep) btnDep.style.display = 'flex';
        }
        await this.cargarActivos();
        this.initFiltrosListeners();
    },

    async cargarMetodosPago() {
        try {
            const res = await api.get('/reportes/metodos-pago');
            this.metodosPagoCache = (res && res.data) ? res.data : [];
        } catch (err) {
            console.error("Error al cargar métodos de pago:", err);
            this.metodosPagoCache = [];
        }
    },

    // Llena los dos <select> de tipo (filtro y formulario) desde el catálogo real
    async cargarTipos() {
        try {
            const res = await api.get('/activos/tipos');
            this.tiposCache = (res && res.data) ? res.data : [];
        } catch (err) {
            console.error("Error al cargar tipos de activo:", err);
            this.tiposCache = [];
        }

        const opcionesTipo = this.tiposCache
            .map(t => `<option value="${t.TipoID}">${t.Nombre}</option>`)
            .join('');

        const selFiltro = document.getElementById('filtroTipoActivo');
        if (selFiltro) {
            selFiltro.innerHTML = '<option value="TODOS">Todos los Tipos</option>' + opcionesTipo;
            selFiltro.value = this.state.tipo || 'TODOS';
        }

        const selForm = document.getElementById('tipo-input');
        if (selForm) {
            selForm.innerHTML = opcionesTipo || '<option value="">— sin tipos —</option>';
        }
    },

    renderSedeSelector() {
        App.renderSedeSelector('sedeSelectorActivos', () => this.cargarActivos());
    },

    getSedeId() {
        const selector = document.getElementById('globalSedeSelector');
        if (selector) return selector.value;
        return localStorage.getItem('currentSedeId') || App.user.SedeID;
    },

    initFiltrosListeners() {
        const inputBusqueda = document.getElementById('filtroTextoActivo');
        const selectTipo = document.getElementById('filtroTipoActivo');
        const selectEstado = document.getElementById('filtroEstadoActivo');

        if (inputBusqueda) {
            inputBusqueda.oninput = (e) => { 
                this.state.busqueda = e.target.value; 
                this.renderizarGrid(); 
            };
        }
        if (selectTipo) {
            selectTipo.onchange = (e) => { 
                this.state.tipo = e.target.value; 
                this.renderizarGrid(); 
            };
        }
        if (selectEstado) {
            selectEstado.onchange = (e) => {
                this.state.estado = e.target.value;
                this.renderizarGrid();
            };
        }
        const chkBajas = document.getElementById('chkIncluirBajas');
        if (chkBajas) {
            chkBajas.checked = this.state.incluirBajas;
            chkBajas.onchange = (e) => {
                this.state.incluirBajas = e.target.checked;
                this.cargarActivos();
            };
        }
    },

    async cargarActivos() {
        try {
            const sedeId = this.getSedeId();
            
            const resSede = await api.get(`/sede/${sedeId}`);
            this.sedeActualInfo = resSede.data || { NombreComercial: "Sede Central" };

            const qs = this.state.incluirBajas ? '?incluirBajas=1' : '';
            const res = await api.get(`/activos/${sedeId}${qs}`);
            this.activosCache = (res && res.data) ? res.data : [];
            this.renderizarGrid();
        } catch (err) {
            console.error("Error al cargar activos:", err);
            const grid = document.getElementById('grid-activos');
            if (grid) grid.innerHTML = '<p style="padding:20px; color:red;">Error de conexión con la base de datos.</p>';
        }
    },

    renderizarGrid() {
        const grid = document.getElementById('grid-activos');
        if (!grid) return;

        const activosFiltrados = this.activosCache.filter(a => {
            const busquedaLower = this.state.busqueda.toLowerCase();
            const matchBusqueda = a.Nombre.toLowerCase().includes(busquedaLower) || 
                                  (a.SeriePlaca && a.SeriePlaca.toLowerCase().includes(busquedaLower));
            const matchTipo = (this.state.tipo === 'TODOS' || a.TipoID == this.state.tipo); 
            const estadoActivo = a.Estado || 'OPERATIVO';
            const matchEstado = (this.state.estado === 'TODOS' || estadoActivo === this.state.estado);

            return matchBusqueda && matchTipo && matchEstado;
        });

        if (activosFiltrados.length === 0) {
            grid.innerHTML = '<p style="grid-column: 1/-1; text-align:center; padding:50px; font-weight:bold; color:#7f8c8d;">NO SE ENCONTRARON ACTIVOS CON ESTOS FILTROS</p>';
            return;
        }

        const baseUrl = api.defaults.baseURL.replace('/api', '');

        const esAdmin = App.isSuperAdmin();

        grid.innerHTML = activosFiltrados.map(a => {
            const esBaja = (a.Estado === 'BAJA' || a.Estado === 'VENDIDO');
            const necesitaReingreso = (a.Estado === 'EN TRÁNSITO' || a.Estado === 'EN MANTENIMIENTO');
            const fotoUrl = a.FotoPath
                ? `${baseUrl}/uploads/${String(a.FotoPath).replace(/^\/?uploads\//, '')}`
                : '';
            const cant = parseInt(a.Cantidad, 10) || 1;
            const valorUnit = parseFloat(a.ValorCompra || 0);
            const valorTotal = valorUnit * cant;
            return `
                <div class="card-activo" style="border: 1px solid #ccc; padding: 20px; border-radius: 20px; text-align: center; background: var(--hotel-bg); box-shadow: 6px 6px 12px var(--hotel-shadow-dark); ${esBaja ? 'opacity:0.72;' : ''}">
                    ${esBaja ? `<div style="background:${a.Estado === 'VENDIDO' ? '#c5a059' : '#e74c3c'}; color:#fff; font-weight:900; font-size:0.75rem; letter-spacing:1px; padding:5px; border-radius:8px; margin-bottom:10px;">${a.Estado}</div>` : ''}
                    <h3 style="margin-top:0; margin-bottom:2px; color: var(--hotel-blue); font-size: 1.1rem; text-transform: uppercase;">${a.Nombre}${cant > 1 ? ` <span style="color:var(--hotel-gold)">×${cant}</span>` : ''}</h3>
                    ${(a.Marca || a.Modelo) ? `<p style="margin:0 0 8px; font-size:0.7rem; font-weight:700; color:#7f8c8d; text-transform:uppercase;">${[a.Marca, a.Modelo].filter(Boolean).join(' · ')}</p>` : ''}
                    ${fotoUrl ? `<img src="${fotoUrl}" alt="Foto" style="width:100%; max-height:150px; object-fit:cover; border-radius:12px; margin-bottom:10px;">` : ''}
                    <div id="qr-${a.ActivoID}" class="qr-container" style="width: 100px; height: 100px; margin: 15px auto; background: white; padding: 5px; border-radius: 10px;"></div>
                    <p style="margin: 5px 0; font-size: 0.85rem;"><strong>SERIE:</strong> ${a.SeriePlaca || 'S/N'}</p>
                    ${a.Ubicacion ? `<p style="margin: 5px 0; font-size: 0.85rem;"><strong>UBICACIÓN:</strong> ${a.Ubicacion}</p>` : ''}
                    <p style="margin: 5px 0; font-size: 0.85rem;"><strong>VALOR:</strong> $${valorTotal.toFixed(2)}${cant > 1 ? ` <span style="opacity:.6">($${valorUnit.toFixed(2)} c/u)</span>` : ''}</p>
                    ${(!esBaja && a.ValorEnLibros != null && Number(a.DepreciacionAcumulada) > 0) ? `<p style="margin: 3px 0; font-size: 0.8rem; color:#2e7d32;"><strong>EN LIBROS:</strong> $${Number(a.ValorEnLibros).toFixed(2)} <span style="opacity:.6">(dep. $${Number(a.DepreciacionAcumulada).toFixed(2)})</span>${esAdmin ? ` · <a href="#" onclick="event.preventDefault(); ActivosModule.verDepreciaciones(${a.ActivoID})" style="color:#2f7be6; font-weight:800;">historial</a>` : ''}</p>` : ''}
                    <p style="margin: 5px 0; font-size: 0.85rem;"><strong>ESTADO:</strong> <span style="color:var(--hotel-gold)">${a.Estado || 'OPERATIVO'}</span>${a.Condicion ? ` &nbsp;·&nbsp; <strong>COND:</strong> ${a.Condicion}` : ''}</p>
                    ${a.Responsable ? `<p style="margin: 5px 0; font-size: 0.8rem;"><strong>RESP:</strong> ${a.Responsable}</p>` : ''}
                    ${a.Observacion ? `<p style="margin: 5px 0; font-size: 0.75rem; font-style:italic; opacity:0.8;">"${a.Observacion}"</p>` : ''}
                    ${esBaja ? `
                        <p style="margin: 8px 0 3px; font-size: 0.8rem;"><strong>MOTIVO:</strong> ${a.MotivoBaja || '—'}${a.ValorBaja ? ` · $${Number(a.ValorBaja).toFixed(2)}` : ''}</p>
                        <p style="margin: 3px 0; font-size: 0.75rem; color:#7f8c8d;">${a.FechaBaja ? String(a.FechaBaja).slice(0, 10) : ''}${a.VoucherBajaPath ? ` · <a href="#" onclick="event.preventDefault(); ActivosModule._abrirArchivo('${a.VoucherBajaPath}')" style="color:#2f7be6; font-weight:800;">comprobante</a>` : ''}</p>
                    ` : ''}
                    <div style="display:flex; flex-direction:column; gap:10px; margin-top:15px;">
                        ${esBaja ? `
                            ${esAdmin ? `
                                <button class="btn-neo no-print" style="justify-content:center; background:#2e7d32; color:white;" onclick="ActivosModule.reactivar(${a.ActivoID})">
                                    <i class="fas fa-rotate-left"></i> REACTIVAR
                                </button>
                            ` : ''}
                        ` : `
                            ${necesitaReingreso ? `
                                <button class="btn-neo no-print" style="justify-content:center; background: #27ae60; color: white;" onclick="ActivosModule.abrirModalReingreso(${a.ActivoID})">
                                    <i class="fas fa-check-circle"></i> CONFIRMAR RECEPCIÓN
                                </button>
                            ` : `
                                <button class="btn-neo no-print" style="justify-content:center;" onclick="ActivosModule.abrirModalMovimiento(${a.ActivoID})">
                                    <i class="fas fa-exchange-alt"></i> REGISTRAR SALIDA
                                </button>
                            `}
                            ${esAdmin ? `
                                <button class="btn-neo no-print" style="justify-content:center; background:#34495e; color:white;" onclick="ActivosModule.abrirModalEdicion(${a.ActivoID})">
                                    <i class="fas fa-pen"></i> EDITAR
                                </button>
                                <button class="btn-neo no-print" style="justify-content:center; background:#c0392b; color:white;" onclick="ActivosModule.abrirModalBaja(${a.ActivoID})">
                                    <i class="fas fa-arrow-down-up-across-line"></i> DAR DE BAJA / VENDER
                                </button>
                            ` : ''}
                        `}
                    </div>
                </div>
            `;
        }).join('');

        activosFiltrados.forEach(a => {
            const container = document.getElementById(`qr-${a.ActivoID}`);
            if (container && window.QRCode) {
                container.innerHTML = '';
                const qrText = `ACTIVO: ${a.Nombre}\nSERIE: ${a.SeriePlaca || 'S/N'}\nSEDE: ${this.sedeActualInfo.NombreComercial}\nID: ${a.ActivoID}`;
                new window.QRCode(container, {
                    text: qrText,
                    width: 100, 
                    height: 100,
                    correctLevel: window.QRCode.CorrectLevel.H
                });
            }
        });
    },

    gestionarCambioTipoMovimiento(valor) {
        const contenedorSede = document.getElementById('div-sede-destino');
        if (contenedorSede) {
            contenedorSede.style.display = (valor === 'TRASLADO') ? 'block' : 'none';
        }
    },

    // --- SOLUCIÓN: PRE-RENDERIZADO BASE64 ---
    async imprimirTodasLasEtiquetas() {
        if (this.activosCache.length === 0) return alert("No hay activos para imprimir.");

        const sedeNombre = this.sedeActualInfo ? this.sedeActualInfo.NombreComercial : "MASTER HOTEL";

        // Función auxiliar para convertir un texto a QR en Base64 usando el DOM actual
        const generarQRBase64 = (texto) => {
            return new Promise((resolve) => {
                const tempDiv = document.createElement('div');
                new window.QRCode(tempDiv, {
                    text: texto,
                    width: 90,
                    height: 90,
                    correctLevel: window.QRCode.CorrectLevel.M
                });
                
                // Extraer el Base64 del canvas generado
                setTimeout(() => {
                    const canvas = tempDiv.querySelector('canvas');
                    if (canvas) {
                        resolve(canvas.toDataURL('image/png'));
                    } else {
                        const img = tempDiv.querySelector('img');
                        resolve(img ? img.src : '');
                    }
                }, 20);
            });
        };

        // Construir HTML inyectando directamente las imágenes
        let etiquetasHTML = '';
        for (const a of this.activosCache) {
            const txt = `ACTIVO: ${a.Nombre}\nSERIE: ${a.SeriePlaca || 'N/A'}\nSEDE: ${sedeNombre}\nID: ${a.ActivoID}`;
            const base64Img = await generarQRBase64(txt);

            etiquetasHTML += `
                <div class="etiqueta">
                    <div class="header-tag">${sedeNombre}</div>
                    <div class="activo-name">${a.Nombre}</div>
                    <div class="qr-box">
                        <img src="${base64Img}" style="width: 100%; height: 100%; object-fit: contain;">
                    </div>
                    <div class="footer-tag">S/N: ${a.SeriePlaca || 'N/A'}</div>
                    <div class="footer-tag" style="font-weight:bold;">ID CONTROL: ${a.ActivoID}</div>
                </div>
            `;
        }

        // Generar la ventana de impresión pura y estática
        const ventana = window.open('', '_blank');
        ventana.document.write(`
            <html>
                <head>
                    <title>Etiquetas Auditales - ${sedeNombre}</title>
                    <style>
                        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 10px; background: white; }
                        .grid-etiquetas { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; }
                        .etiqueta { border: 1px solid #1a365d; padding: 10px; text-align: center; page-break-inside: avoid; border-radius: 8px; }
                        .header-tag { font-size: 9px; font-weight: bold; color: #1a365d; border-bottom: 1px solid #c5a059; margin-bottom: 5px; padding-bottom: 2px; text-transform: uppercase; }
                        .activo-name { font-size: 11px; font-weight: 800; margin: 4px 0; color: #000; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                        .qr-box { width: 90px; height: 90px; margin: 5px auto; }
                        .footer-tag { font-size: 8px; font-weight: 600; color: #444; margin-top: 2px; }
                        @media print { .no-print { display: none !important; } }
                    </style>
                </head>
                <body>
                    <div class="no-print" style="background:#1a365d; color:white; padding:15px; text-align:center; cursor:pointer; font-weight:bold; margin-bottom:20px; border-radius:5px;" onclick="window.print()">
                        <i class="fas fa-print"></i> CLIC AQUÍ PARA INICIAR IMPRESIÓN DE ETIQUETAS
                    </div>
                    <div class="grid-etiquetas">
                        ${etiquetasHTML}
                    </div>
                </body>
            </html>
        `);
        ventana.document.close();
    },

    // Muestra el QR + enlace para abrir la herramienta de levantamiento en el celular
    async mostrarQRLevantamiento() {
        // La URL para el celular la da el backend (PUBLIC_URL del .env) — el
        // escritorio suele hablar por localhost, que un celular no alcanza.
        let urlLevantamiento;
        try {
            const r = await api.get('/activos/levantamiento-url');
            urlLevantamiento = r.data.url;
        } catch (e) {
            urlLevantamiento = api.defaults.baseURL.replace('/api', '') + '/assets/levantamiento/';
        }

        await loadQRCodeLib();

        let qrBase64 = '';
        if (window.QRCode) {
            const tmp = document.createElement('div');
            new window.QRCode(tmp, {
                text: urlLevantamiento,
                width: 260, height: 260,
                correctLevel: window.QRCode.CorrectLevel.M
            });
            await new Promise(r => setTimeout(r, 40));
            const canvas = tmp.querySelector('canvas');
            const img = tmp.querySelector('img');
            qrBase64 = canvas ? canvas.toDataURL('image/png') : (img ? img.src : '');
        }

        const ventana = window.open('', '_blank', 'width=520,height=680');
        ventana.document.write(`
            <html>
                <head>
                    <title>Levantamiento de Activos — Celular</title>
                    <style>
                        body { font-family: 'Segoe UI', sans-serif; text-align:center; padding:40px; color:#1a365d; background:#eef0f4; }
                        h2 { letter-spacing:1px; text-transform:uppercase; }
                        .qr { background:#fff; padding:20px; border-radius:20px; display:inline-block; box-shadow:0 10px 30px rgba(0,0,0,.15); }
                        .url { margin-top:25px; font-size:14px; word-break:break-all; }
                        .url a { color:#16a085; font-weight:bold; }
                        ol { text-align:left; max-width:360px; margin:30px auto 0; font-size:13px; line-height:1.7; color:#333; }
                    </style>
                </head>
                <body>
                    <h2>Levantamiento de Activos</h2>
                    <p style="font-size:13px; color:#7f8c8d;">Escanea este código con la cámara del celular</p>
                    <div class="qr">
                        ${qrBase64 ? `<img src="${qrBase64}" width="260" height="260">` : '<p>No se pudo generar el QR</p>'}
                    </div>
                    <div class="url">
                        <a href="${urlLevantamiento}" target="_blank">${urlLevantamiento}</a>
                    </div>
                    <ol>
                        <li>Abre el enlace en el celular e ingresa con tu usuario del sistema.</li>
                        <li>Elige Sede y Tipo una sola vez (quedan fijos).</li>
                        <li>Por cada activo: foto, nombre, serie/placa, valor y ubicación.</li>
                        <li>"Guardar y siguiente" — aparece de inmediato en este módulo.</li>
                    </ol>
                </body>
            </html>
        `);
        ventana.document.close();
    },

    async imprimirReporteOficial(tipoFiltro = 'TODOS') {
        const baseUrl = api.defaults.baseURL.replace('/api', '');
        const fmt = n => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

        // Inventario = no incluye dados de baja / vendidos
        let datos = this.activosCache.filter(a => a.Estado !== 'BAJA' && a.Estado !== 'VENDIDO');
        if (tipoFiltro !== 'TODOS') datos = datos.filter(a => a.TipoID == tipoFiltro);

        if (datos.length === 0) return alert('No hay activos para el reporte con este filtro.');

        // Agrupar por tipo, ordenar por nombre dentro de cada grupo
        const grupos = {};
        datos.forEach(a => {
            const k = a.TipoNombre || 'Sin tipo';
            (grupos[k] = grupos[k] || []).push(a);
        });
        Object.values(grupos).forEach(arr => arr.sort((x, y) => (x.Nombre || '').localeCompare(y.Nombre || '')));
        const tiposOrdenados = Object.keys(grupos).sort((a, b) => a.localeCompare(b));

        const valTotal = a => (parseFloat(a.ValorCompra || 0)) * (parseInt(a.Cantidad, 10) || 1);
        const enLibros = a => (a.ValorEnLibros != null) ? Number(a.ValorEnLibros) : valTotal(a) - Number(a.DepreciacionAcumulada || 0);

        let gCompra = 0, gDep = 0, gLibros = 0, gItems = 0;

        const cuerpo = tiposOrdenados.map(tipo => {
            const arr = grupos[tipo];
            let sCompra = 0, sDep = 0, sLibros = 0, sItems = 0;
            const filas = arr.map(a => {
                const cant = parseInt(a.Cantidad, 10) || 1;
                const vc = valTotal(a), dep = Number(a.DepreciacionAcumulada || 0), vl = enLibros(a);
                sCompra += vc; sDep += dep; sLibros += vl; sItems += cant;
                const foto = a.FotoPath ? `${baseUrl}/uploads/${String(a.FotoPath).replace(/^\/?uploads\//, '')}` : '';
                return `
                    <tr>
                        <td class="c-foto">${foto ? `<img src="${esc(foto)}">` : '<span class="sinfoto">—</span>'}</td>
                        <td>
                            <strong>${esc(a.Nombre)}</strong>
                            ${(a.Marca || a.Modelo) ? `<br><span class="sub">${esc([a.Marca, a.Modelo].filter(Boolean).join(' · '))}</span>` : ''}
                            ${a.CodigoQR ? `<br><span class="sub">${esc(a.CodigoQR)}</span>` : ''}
                        </td>
                        <td>${esc(a.SeriePlaca || 'S/N')}</td>
                        <td>${esc(a.Ubicacion || '—')}</td>
                        <td>${esc(a.Estado || 'OPERATIVO')}${a.Condicion ? `<br><span class="sub">${esc(a.Condicion)}</span>` : ''}</td>
                        <td class="num">${cant}</td>
                        <td class="num">${fmt(vc)}</td>
                        <td class="num">${fmt(dep)}</td>
                        <td class="num">${fmt(vl)}</td>
                    </tr>`;
            }).join('');

            gCompra += sCompra; gDep += sDep; gLibros += sLibros; gItems += sItems;

            return `
                <tr class="grupo"><td colspan="9">${esc(tipo)} — ${arr.length} activo(s)</td></tr>
                ${filas}
                <tr class="subtotal">
                    <td colspan="5" class="num">Subtotal ${esc(tipo)}</td>
                    <td class="num">${sItems}</td>
                    <td class="num">${fmt(sCompra)}</td>
                    <td class="num">${fmt(sDep)}</td>
                    <td class="num">${fmt(sLibros)}</td>
                </tr>`;
        }).join('');

        let logoUrl = '';
        if (this.sedeActualInfo && this.sedeActualInfo.LogoPath) {
            const fileName = String(this.sedeActualInfo.LogoPath).split(/[\\/]/).pop();
            logoUrl = `${baseUrl}/uploads/sedes/logos/${fileName}`;
        }
        const fecha = new Date().toLocaleString('es-EC');
        const ventana = window.open('', '_blank', 'width=1000,height=850');

        ventana.document.write(`
            <html>
            <head>
                <title>Reporte de Activos — ${esc(this.sedeActualInfo ? this.sedeActualInfo.NombreComercial : '')}</title>
                <style>
                    * { box-sizing: border-box; }
                    body { font-family: 'Segoe UI', Arial, sans-serif; padding: 34px; color: #222; font-size: 12px; }
                    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #1a365d; padding-bottom: 16px; }
                    .logo { max-height: 70px; }
                    h1 { font-size: 1.2rem; margin: 0; color: #1a365d; letter-spacing: 1px; text-transform: uppercase; }
                    .meta { text-align: right; font-size: 11px; color: #555; }
                    .resumen { display: flex; gap: 18px; margin: 18px 0 8px; flex-wrap: wrap; }
                    .kpi { border: 1px solid #d9dee6; border-radius: 8px; padding: 8px 14px; }
                    .kpi b { display: block; font-size: 1.05rem; color: #1a365d; }
                    .kpi span { font-size: 10px; color: #777; text-transform: uppercase; letter-spacing: .5px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                    th { background: #1a365d; color: #fff; padding: 7px 8px; text-align: left; font-size: 10.5px; text-transform: uppercase; }
                    td { padding: 6px 8px; border-bottom: 1px solid #e3e3e3; vertical-align: top; }
                    td.num, th.num { text-align: right; }
                    .c-foto { width: 52px; }
                    .c-foto img { width: 44px; height: 44px; object-fit: cover; border-radius: 5px; border: 1px solid #ccc; }
                    .sinfoto { color: #bbb; }
                    .sub { font-size: 10px; color: #888; }
                    tr.grupo td { background: #eef1f6; font-weight: 800; color: #1a365d; text-transform: uppercase; letter-spacing: .5px; padding: 7px 8px; border-top: 2px solid #1a365d; }
                    tr.subtotal td { background: #f7f7f7; font-weight: 700; border-top: 1px solid #bbb; }
                    tr.total td { background: #1a365d; color: #fff; font-weight: 800; font-size: 12.5px; }
                    tr { page-break-inside: avoid; }
                    .firmas { display: flex; justify-content: space-around; margin-top: 70px; }
                    .linea { width: 200px; border-top: 1px solid #000; text-align: center; padding-top: 8px; font-weight: bold; font-size: 11px; }
                    @media print { .noprint { display: none; } }
                </style>
            </head>
            <body onload="setTimeout(function(){ window.print(); }, 700)">
                <header>
                    ${logoUrl ? `<img src="${esc(logoUrl)}" class="logo" onerror="this.style.display='none'">` : '<div></div>'}
                    <div class="meta">
                        <h1>Inventario de Activos Fijos</h1>
                        <div>${esc(this.sedeActualInfo ? this.sedeActualInfo.NombreComercial : '')}</div>
                        <div>Generado: ${esc(fecha)}</div>
                        ${tipoFiltro !== 'TODOS' ? `<div>Filtro: ${esc(tiposOrdenados[0] || '')}</div>` : ''}
                    </div>
                </header>

                <div class="resumen">
                    <div class="kpi"><b>${datos.length}</b><span>Activos</span></div>
                    <div class="kpi"><b>${gItems}</b><span>Ítems (unidades)</span></div>
                    <div class="kpi"><b>${fmt(gCompra)}</b><span>Valor de compra</span></div>
                    <div class="kpi"><b>${fmt(gDep)}</b><span>Depreciación acum.</span></div>
                    <div class="kpi"><b>${fmt(gLibros)}</b><span>Valor en libros</span></div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>Foto</th><th>Ítem</th><th>Serie / Placa</th><th>Ubicación</th><th>Estado</th>
                            <th class="num">Cant.</th><th class="num">V. compra</th><th class="num">Dep. acum.</th><th class="num">V. en libros</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${cuerpo}
                        <tr class="total">
                            <td colspan="5" class="num">TOTAL GENERAL</td>
                            <td class="num">${gItems}</td>
                            <td class="num">${fmt(gCompra)}</td>
                            <td class="num">${fmt(gDep)}</td>
                            <td class="num">${fmt(gLibros)}</td>
                        </tr>
                    </tbody>
                </table>

                <div class="firmas">
                    <div class="linea">Elaborado por</div>
                    <div class="linea">Gerencia</div>
                    <div class="linea">Recibido</div>
                </div>
            </body>
            </html>
        `);
        ventana.document.close();
    },

    imprimirActaMovimiento(datos) {
        const ventanaActa = window.open('', '_blank', 'width=800,height=800');
        ventanaActa.document.write(`
            <html>
                <head>
                    <title>Acta de Movimiento</title>
                    <style>
                        body { font-family: sans-serif; padding: 50px; line-height: 1.5; }
                        .header { text-align: center; border-bottom: 2px solid #1a365d; margin-bottom: 30px; padding-bottom: 10px; }
                        .content { margin-bottom: 50px; }
                        .firmas { display: flex; justify-content: space-between; margin-top: 100px; }
                        .linea { width: 250px; border-top: 1px solid #000; text-align: center; padding-top: 10px; font-weight: bold; }
                    </style>
                </head>
                <body onload="window.print(); setTimeout(() => { window.close(); }, 500)">
                    <div class="header">
                        <h2>${this.sedeActualInfo.NombreComercial}</h2>
                        <h3>ACTA DE ENTREGA / RECEPCIÓN DE ACTIVO</h3>
                    </div>
                    <div class="content">
                        <p><strong>FECHA:</strong> ${new Date().toLocaleString()}</p>
                        <p><strong>TIPO DE MOVIMIENTO:</strong> ${datos.Tipo}</p>
                        <hr>
                        <p><strong>ACTIVO:</strong> ${datos.Nombre}</p>
                        <p><strong>SERIE / PLACA:</strong> ${datos.Serie}</p>
                        <p><strong>RESPONSABLE:</strong> ${datos.Responsable}</p>
                        <p><strong>OBSERVACIONES:</strong> ${datos.Observaciones || 'Sin observaciones adicionales'}</p>
                    </div>
                    <div class="firmas">
                        <div class="linea">ENTREGUÉ CONFORME</div>
                        <div class="linea">RECIBÍ CONFORME</div>
                    </div>
                </body>
            </html>
        `);
        ventanaActa.document.close();
    },

    async cargarHistorial(id) {
        const lista = document.getElementById('lista-historial-mov');
        const container = document.getElementById('historial-movimientos-container');
        if (!lista || !container) return;

        lista.innerHTML = '<p style="text-align:center; font-size:0.7rem;">Cargando historial...</p>';
        container.style.display = 'block';

        try {
            const res = await api.get(`/activos/historial/${id}`);
            const historial = res.data || [];

            if (historial.length === 0) {
                lista.innerHTML = '<p style="text-align:center; font-size:0.7rem; opacity:0.6;">Sin movimientos previos.</p>';
                return;
            }

            lista.innerHTML = historial.map(h => `
                <div class="timeline-item" style="padding: 10px; margin-bottom: 10px; border-radius: 10px; background: var(--hotel-bg); box-shadow: 3px 3px 6px var(--hotel-shadow-dark), -3px -3px 6px var(--hotel-shadow-light); font-size: 0.75rem;">
                    <div style="display:flex; justify-content:space-between; font-weight:900; color:var(--hotel-blue); margin-bottom:5px;">
                        <span>${h.TipoMovimiento}</span>
                        <span>${new Date(h.FechaMovimiento).toLocaleDateString()}</span>
                    </div>
                    <p style="margin:0; opacity:0.8;"><strong>Resp:</strong> ${h.Responsable}</p>
                    <p style="margin:0; font-style:italic; font-size:0.7rem;">"${h.Observaciones || 'Sin observaciones'}"</p>
                </div>
            `).join('');
        } catch (err) {
            lista.innerHTML = '<p style="color:red; font-size:0.7rem;">Error al cargar historial.</p>';
        }
    },

    async ejecutarConfirmacion() {
        if (this.modoActual === 'REGISTRO') {
            await this.guardar();
        } else if (this.modoActual === 'EDICION') {
            await this.actualizarActivo();
        } else if (this.modoActual === 'MOVIMIENTO') {
            await this.registrarMovimiento();
        } else if (this.modoActual === 'REINGRESO') {
            await this.confirmarReingreso();
        }
    },

    // Arma el FormData del formulario de activo (alta y edición). Devuelve null si falta lo obligatorio.
    _formDataActivo() {
        let cantidad = parseInt(document.getElementById('cantidad-input').value, 10);
        if (isNaN(cantidad) || cantidad < 1) cantidad = 1;

        const nombre = document.getElementById('nombre-input').value.trim();
        const tipoId = parseInt(document.getElementById('tipo-input').value);
        if (!nombre || isNaN(tipoId)) {
            alert("Nombre y Tipo de Activo son obligatorios.");
            return null;
        }

        const fd = new FormData();
        fd.append('Nombre', nombre);
        fd.append('Marca', document.getElementById('marca-input').value.trim());
        fd.append('Modelo', document.getElementById('modelo-input').value.trim());
        fd.append('SeriePlaca', document.getElementById('serie-input').value.trim());
        fd.append('ValorCompra', parseFloat(document.getElementById('valor-input').value) || 0);
        fd.append('TipoID', tipoId);
        fd.append('SedeActualID', parseInt(this.getSedeId()));
        fd.append('Estado', document.getElementById('estado-input').value);
        fd.append('Condicion', document.getElementById('condicion-input').value);
        fd.append('Cantidad', cantidad);
        fd.append('FechaAdquisicion', document.getElementById('fecha-input').value || '');
        fd.append('Ubicacion', document.getElementById('ubicacion-input').value.trim());
        fd.append('Responsable', document.getElementById('responsable-activo-input').value.trim());
        fd.append('Observacion', document.getElementById('observacion-input').value.trim());
        fd.append('VidaUtilMeses', document.getElementById('vidautil-input').value || '');
        fd.append('ValorResidual', document.getElementById('residual-input').value || '0');

        const fotoEl = document.getElementById('foto-input');
        if (fotoEl && fotoEl.files && fotoEl.files[0]) fd.append('foto', fotoEl.files[0]);
        return fd;
    },

    async guardar() {
        const fd = this._formDataActivo();
        if (!fd) return;
        try {
            await api.post('/activos', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            this.cerrarModal();
            await this.cargarActivos();
        } catch (err) {
            console.error("Error al guardar activo:", err);
            alert((err && err.response && err.response.data && err.response.data.error) || "Error al guardar activo.");
        }
    },

    async actualizarActivo() {
        const id = parseInt(document.getElementById('activoId-input').value);
        if (!id) return alert("No se identificó el activo.");
        const fd = this._formDataActivo();
        if (!fd) return;
        try {
            await api.put('/activos/' + id, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            this.cerrarModal();
            await this.cargarActivos();
        } catch (err) {
            console.error("Error al editar activo:", err);
            alert((err && err.response && err.response.data && err.response.data.error) || "Error al editar activo.");
        }
    },

    async registrarMovimiento() {
        const user = JSON.parse(localStorage.getItem('user'));
        const tipoMov = document.getElementById('tipo-mov-input').value;
        const responsable = document.getElementById('responsable-input').value.trim();
        const obs = document.getElementById('obs-input').value.trim();
        
        const payload = {
            ActivoID: parseInt(document.getElementById('activoId-input').value),
            TipoMovimiento: tipoMov,
            Observaciones: obs,
            Responsable: responsable,
            SedeOrigenID: parseInt(this.getSedeId()),
            UsuarioID: user ? user.UsuarioID : 1,
            SedeDestinoID: tipoMov === 'TRASLADO' ? parseInt(document.getElementById('sede-destino-input').value) : null
        };

        if (!payload.ActivoID) return alert("No se identificó el activo.");

        try {
            const res = await api.post('/activos/movimiento', payload);
            if (res.data.success) {
                const activo = this.activosCache.find(a => a.ActivoID === payload.ActivoID);
                this.imprimirActaMovimiento({
                    Nombre: activo.Nombre,
                    Serie: activo.SeriePlaca || 'S/N',
                    Responsable: responsable,
                    Tipo: tipoMov,
                    Observaciones: obs
                });
                this.cerrarModal();
                await this.cargarActivos();
            }
        } catch (err) {
            console.error("Error en Registrar Movimiento:", err);
            alert("Error al registrar movimiento.");
        }
    },

    async confirmarReingreso() {
        const user = JSON.parse(localStorage.getItem('user'));
        const responsable = document.getElementById('responsable-input').value.trim();
        const obs = document.getElementById('obs-input').value.trim();

        const payload = {
            ActivoID: parseInt(document.getElementById('activoId-input').value),
            UsuarioID: user ? user.UsuarioID : 1,
            Observaciones: obs,
            Responsable: responsable || 'RECEPCIÓN',
            SedeActualID: parseInt(this.getSedeId())
        };

        try {
            const res = await api.post('/activos/recepcion', payload);
            if (res.data.success) {
                const activo = this.activosCache.find(a => a.ActivoID === payload.ActivoID);
                this.imprimirActaMovimiento({
                    Nombre: activo.Nombre,
                    Serie: activo.SeriePlaca || 'S/N',
                    Responsable: payload.Responsable,
                    Tipo: 'RECEPCIÓN / REINGRESO',
                    Observaciones: obs
                });
                this.cerrarModal();
                await this.cargarActivos();
            }
        } catch (err) {
            console.error("Error en Recepción:", err);
            alert("Error al confirmar recepción.");
        }
    },

    abrirModalRegistro() {
        this.modoActual = 'REGISTRO';
        this.limpiarFormulario();
        const titulo = document.getElementById('modal-titulo');
        if (titulo) titulo.textContent = 'Nuevo Activo';
        document.getElementById('form-registro').style.display = 'block';
        document.getElementById('form-movimiento').style.display = 'none';
        if (document.getElementById('historial-movimientos-container')) {
            document.getElementById('historial-movimientos-container').style.display = 'none';
        }
        document.getElementById('modal-activos').classList.remove('modal-hidden');
    },

    // Editar activo — solo visible para SuperAdmin (el botón se pinta con ese guard)
    abrirModalEdicion(id) {
        const a = this.activosCache.find(x => x.ActivoID === id);
        if (!a) return;

        this.modoActual = 'EDICION';
        this.limpiarFormulario();

        const titulo = document.getElementById('modal-titulo');
        if (titulo) titulo.textContent = `Editar Activo #${id}`;

        document.getElementById('form-registro').style.display = 'block';
        document.getElementById('form-movimiento').style.display = 'none';
        if (document.getElementById('historial-movimientos-container')) {
            document.getElementById('historial-movimientos-container').style.display = 'none';
        }

        document.getElementById('activoId-input').value = id;
        document.getElementById('nombre-input').value = a.Nombre || '';
        document.getElementById('marca-input').value = a.Marca || '';
        document.getElementById('modelo-input').value = a.Modelo || '';
        document.getElementById('serie-input').value = a.SeriePlaca || '';
        document.getElementById('valor-input').value = (a.ValorCompra != null) ? a.ValorCompra : '';
        document.getElementById('cantidad-input').value = a.Cantidad || 1;
        document.getElementById('tipo-input').value = a.TipoID || '';
        document.getElementById('estado-input').value = a.Estado || 'OPERATIVO';
        document.getElementById('condicion-input').value = a.Condicion || 'BUENO';
        document.getElementById('fecha-input').value = a.FechaAdquisicion ? String(a.FechaAdquisicion).slice(0, 10) : '';
        document.getElementById('ubicacion-input').value = a.Ubicacion || '';
        document.getElementById('responsable-activo-input').value = a.Responsable || '';
        document.getElementById('observacion-input').value = a.Observacion || '';
        document.getElementById('vidautil-input').value = a.VidaUtilMeses || '';
        document.getElementById('residual-input').value = (a.ValorResidual != null) ? a.ValorResidual : '';

        const prev = document.getElementById('foto-preview');
        if (prev) {
            if (a.FotoPath) {
                const baseUrl = api.defaults.baseURL.replace('/api', '');
                const url = `${baseUrl}/uploads/${String(a.FotoPath).replace(/^\/?uploads\//, '')}`;
                prev.innerHTML = `<img src="${url}" style="max-height:120px; border-radius:10px;"><br><span style="font-size:0.7rem; color:#7f8c8d;">Foto actual — elige una nueva para reemplazarla</span>`;
            } else {
                prev.innerHTML = '';
            }
        }

        document.getElementById('modal-activos').classList.remove('modal-hidden');
    },

    async abrirModalMovimiento(id) {
        this.modoActual = 'MOVIMIENTO';
        this.limpiarFormulario();
        const t = document.getElementById('modal-titulo');
        if (t) t.textContent = 'Registrar Salida / Movimiento';
        document.getElementById('activoId-input').value = id;
        document.getElementById('form-registro').style.display = 'none';
        document.getElementById('form-movimiento').style.display = 'block';

        await this.cargarHistorial(id);

        try {
            const res = await api.get('/admin/sedes');
            const sedes = res.data || [];
            const sedeActual = parseInt(this.getSedeId());
            
            const comboSedeDestino = document.getElementById('sede-destino-input');
            if (comboSedeDestino) {
                comboSedeDestino.innerHTML = sedes
                    .filter(s => s.SedeID != sedeActual)
                    .map(s => `<option value="${s.SedeID}">${s.NombreComercial}</option>`)
                    .join('');
            }
        } catch (err) {
            console.error("Error al cargar sedes:", err);
        }

        const comboMov = document.getElementById('tipo-mov-input');
        if (comboMov) comboMov.style.display = 'block';
        this.gestionarCambioTipoMovimiento(comboMov ? comboMov.value : '');

        document.getElementById('modal-activos').classList.remove('modal-hidden');
    },

    async abrirModalReingreso(id) {
        this.modoActual = 'REINGRESO';
        this.limpiarFormulario();
        const t = document.getElementById('modal-titulo');
        if (t) t.textContent = 'Confirmar Recepción / Reingreso';
        document.getElementById('activoId-input').value = id;
        document.getElementById('form-registro').style.display = 'none';
        document.getElementById('form-movimiento').style.display = 'block';
        
        await this.cargarHistorial(id);

        const comboMov = document.getElementById('tipo-mov-input');
        if (comboMov) {
            comboMov.value = 'RECEPCIÓN';
            comboMov.style.display = 'none'; 
        }
        
        const contenedorSede = document.getElementById('div-sede-destino');
        if (contenedorSede) contenedorSede.style.display = 'none';

        document.getElementById('modal-activos').classList.remove('modal-hidden');
    },

    cerrarModal() {
        document.getElementById('modal-activos').classList.add('modal-hidden');
    },

    // ===== BAJA / VENTA =====
    _abrirArchivo(rel) {
        const baseUrl = api.defaults.baseURL.replace('/api', '');
        const url = `${baseUrl}/uploads/${String(rel).replace(/^\/?uploads\//, '')}`;
        window.open(url, '_blank');
    },

    _toggleCamposVenta(motivo) {
        const esVenta = (motivo === 'VENTA' || motivo === 'SUBASTA');
        const box = document.getElementById('baja-campos-venta');
        if (box) box.style.display = esVenta ? 'block' : 'none';
    },

    abrirModalBaja(id) {
        const a = this.activosCache.find(x => x.ActivoID === id);
        if (!a) return;

        document.getElementById('baja-activo-id').value = id;
        document.getElementById('baja-activo-nombre').textContent = `${a.Nombre} (#${id})`;
        document.getElementById('baja-motivo').value = 'VENTA';
        document.getElementById('baja-valor').value = '';
        document.getElementById('baja-comprador').value = '';
        document.getElementById('baja-referencia').value = '';
        document.getElementById('baja-fecha').value = new Date().toISOString().slice(0, 10);
        document.getElementById('baja-responsable').value = (App.user && App.user.NombreFull) || '';
        document.getElementById('baja-obs').value = '';
        const vch = document.getElementById('baja-voucher');
        if (vch) vch.value = '';

        const selMet = document.getElementById('baja-metodo');
        if (selMet) {
            selMet.innerHTML = this.metodosPagoCache
                .map(m => `<option value="${m.MetodoID}">${m.Nombre}</option>`)
                .join('') || '<option value="">— sin métodos —</option>';
        }

        this._toggleCamposVenta('VENTA');
        document.getElementById('modal-baja').classList.remove('modal-hidden');
    },

    cerrarBaja() {
        document.getElementById('modal-baja').classList.add('modal-hidden');
    },

    async guardarBaja() {
        const id = parseInt(document.getElementById('baja-activo-id').value);
        if (!id) return;
        const motivo = document.getElementById('baja-motivo').value;
        const esVenta = (motivo === 'VENTA' || motivo === 'SUBASTA');
        const valor = parseFloat(document.getElementById('baja-valor').value) || 0;
        const metodoId = parseInt(document.getElementById('baja-metodo').value) || null;

        if (esVenta && valor <= 0) return alert('Indica el valor de venta.');
        if (esVenta && !metodoId) return alert('Indica la caja donde entra el dinero.');

        const payload = {
            ActivoID: id,
            Motivo: motivo,
            ValorVenta: esVenta ? valor : 0,
            MetodoPagoID: esVenta ? metodoId : null,
            Comprador: document.getElementById('baja-comprador').value.trim(),
            Referencia: document.getElementById('baja-referencia').value.trim(),
            Fecha: document.getElementById('baja-fecha').value || null,
            Responsable: document.getElementById('baja-responsable').value.trim(),
            Observaciones: document.getElementById('baja-obs').value.trim()
        };

        try {
            await api.post('/activos/baja', payload);

            // Comprobante opcional
            const vch = document.getElementById('baja-voucher');
            if (vch && vch.files && vch.files[0]) {
                const fd = new FormData();
                fd.append('voucher', vch.files[0]);
                await api.post(`/activos/${id}/voucher-baja`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            }

            this.cerrarBaja();
            await this.cargarActivos();
        } catch (err) {
            console.error('Error al dar de baja:', err);
            alert((err && err.response && err.response.data && err.response.data.error) || 'Error al dar de baja.');
        }
    },

    async reactivar(id) {
        if (!confirm('¿Reactivar este activo? Volverá a estado OPERATIVO. El movimiento de Finanzas, si lo hubo, NO se revierte automáticamente.')) return;
        try {
            const res = await api.post(`/activos/${id}/reactivar`, { motivo: 'corrección administrativa' });
            if (res.data && res.data.avisoFinanzas) alert(res.data.avisoFinanzas);
            await this.cargarActivos();
        } catch (err) {
            console.error('Error al reactivar:', err);
            alert((err && err.response && err.response.data && err.response.data.error) || 'Error al reactivar.');
        }
    },

    // ===== DEPRECIACIÓN =====
    abrirDepreciacion() {
        const hoy = new Date();
        // por defecto, el mes anterior
        const prev = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
        document.getElementById('dep-anio').value = prev.getFullYear();
        document.getElementById('dep-mes').value = prev.getMonth() + 1;
        document.getElementById('dep-resultado').innerHTML = '';
        document.getElementById('dep-run-btn').disabled = true;
        document.getElementById('modal-deprec').classList.remove('modal-hidden');
        this._previewDep();
    },

    cerrarDeprec() {
        document.getElementById('modal-deprec').classList.add('modal-hidden');
    },

    async _previewDep() {
        const anio = parseInt(document.getElementById('dep-anio').value);
        const mes = parseInt(document.getElementById('dep-mes').value);
        const cont = document.getElementById('dep-resultado');
        cont.innerHTML = '<p style="text-align:center; color:#7f8c8d;">Calculando…</p>';
        try {
            const r = await api.get(`/activos/depreciacion/preview?sedeId=${this.getSedeId()}&anio=${anio}&mes=${mes}`);
            const plan = r.data.plan || [];
            const porCorrer = plan.filter(p => !p.YaCorrido && p.MontoMes > 0);
            document.getElementById('dep-run-btn').disabled = (porCorrer.length === 0);

            cont.innerHTML = `
                <p style="font-weight:800; color:var(--hotel-blue); margin:5px 0;">
                    ${porCorrer.length} activo(s) por depreciar · Total del mes: $${Number(r.data.totalMes).toFixed(2)}
                </p>
                <table style="width:100%; border-collapse:collapse; font-size:0.78rem;">
                    <thead><tr style="background:#f2f2f2;">
                        <th style="padding:6px 8px; text-align:left;">Activo</th>
                        <th style="padding:6px 8px; text-align:right;">Base</th>
                        <th style="padding:6px 8px; text-align:right;">Mes</th>
                        <th style="padding:6px 8px; text-align:right;">En libros</th>
                        <th style="padding:6px 8px;"></th>
                    </tr></thead>
                    <tbody>
                        ${plan.map(p => `
                            <tr style="border-bottom:1px solid #eee; ${p.MontoMes === 0 ? 'opacity:.5;' : ''}">
                                <td style="padding:6px 8px;">${p.Nombre}<br><span style="font-size:.68rem; color:#999;">${p.TipoNombre || ''} · vida ${p.VidaUtil}m</span></td>
                                <td style="padding:6px 8px; text-align:right;">$${Number(p.BaseDepreciable).toFixed(2)}</td>
                                <td style="padding:6px 8px; text-align:right; font-weight:800;">$${Number(p.MontoMes).toFixed(2)}</td>
                                <td style="padding:6px 8px; text-align:right;">$${Number(p.ValorEnLibros).toFixed(2)}</td>
                                <td style="padding:6px 8px; font-size:.68rem; color:#e67e22;">${p.Motivo || ''}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>`;
        } catch (err) {
            cont.innerHTML = `<p style="color:red;">${(err && err.response && err.response.data && err.response.data.error) || 'Error al calcular el plan.'}</p>`;
        }
    },

    async _runDep() {
        const anio = parseInt(document.getElementById('dep-anio').value);
        const mes = parseInt(document.getElementById('dep-mes').value);
        if (!confirm(`¿Ejecutar la depreciación de ${String(mes).padStart(2, '0')}/${anio}? No se puede deshacer ni volver a correr este mes.`)) return;
        const btn = document.getElementById('dep-run-btn');
        btn.disabled = true; btn.textContent = 'Ejecutando…';
        try {
            const r = await api.post('/activos/depreciacion/correr', { sedeId: this.getSedeId(), anio, mes });
            alert(`Depreciación aplicada: ${r.data.procesados} activo(s), total $${Number(r.data.totalMes).toFixed(2)}.`);
            await this._previewDep();
            await this.cargarActivos();
        } catch (err) {
            alert((err && err.response && err.response.data && err.response.data.error) || 'Error al ejecutar la depreciación.');
        }
        btn.innerHTML = '<i class="fas fa-play"></i> Ejecutar';
    },

    async verDepreciaciones(id) {
        const a = this.activosCache.find(x => x.ActivoID === id);
        try {
            const r = await api.get(`/activos/depreciacion/activo/${id}`);
            const filas = r.data.depreciaciones || [];
            const cuerpo = filas.length
                ? filas.map(f => `<tr style="border-bottom:1px solid #eee;">
                        <td style="padding:6px 10px;">${String(f.Mes).padStart(2, '0')}/${f.Anio}</td>
                        <td style="padding:6px 10px; text-align:right;">$${Number(f.MontoMes).toFixed(2)}</td>
                        <td style="padding:6px 10px; text-align:right;">$${Number(f.DepAcumDespues).toFixed(2)}</td>
                        <td style="padding:6px 10px; font-size:.7rem; color:#999;">${String(f.FechaProceso).slice(0, 10)}</td>
                    </tr>`).join('')
                : '<tr><td colspan="4" style="padding:14px; text-align:center; color:#999;">Sin depreciaciones registradas.</td></tr>';

            const win = window.open('', '_blank', 'width=520,height=560');
            win.document.write(`<html><head><title>Depreciaciones</title>
                <style>body{font-family:sans-serif;padding:24px;color:#333}h3{color:#1a365d}
                table{width:100%;border-collapse:collapse;margin-top:12px;font-size:.85rem}
                th{background:#f2f2f2;padding:6px 10px;text-align:left}</style></head><body>
                <h3>${a ? a.Nombre : 'Activo #' + id}</h3>
                <table><thead><tr><th>Período</th><th style="text-align:right">Monto</th><th style="text-align:right">Dep. acum.</th><th>Procesado</th></tr></thead>
                <tbody>${cuerpo}</tbody></table></body></html>`);
            win.document.close();
        } catch (err) {
            alert('No se pudo cargar el historial de depreciaciones.');
        }
    },

    limpiarFormulario() {
        ['nombre-input', 'marca-input', 'modelo-input', 'serie-input', 'valor-input', 'activoId-input', 'obs-input', 'sede-destino-input', 'responsable-input', 'responsable-activo-input', 'observacion-input', 'fecha-input', 'ubicacion-input', 'foto-input', 'vidautil-input', 'residual-input'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const prev = document.getElementById('foto-preview');
        if (prev) prev.innerHTML = '';
        const cantEl = document.getElementById('cantidad-input');
        if (cantEl) cantEl.value = '1';
        const estEl = document.getElementById('estado-input');
        if (estEl) estEl.value = 'OPERATIVO';
        const condEl = document.getElementById('condicion-input');
        if (condEl) condEl.value = 'BUENO';
        const comboMov = document.getElementById('tipo-mov-input');
        if (comboMov) {
            comboMov.value = 'TRASLADO';
            comboMov.style.display = 'block';
        }
    }
};

module.exports = ActivosModule;