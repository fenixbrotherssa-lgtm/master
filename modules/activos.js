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
    sedeActualInfo: null,
    modoActual: 'REGISTRO', 
    state: {
        busqueda: '',
        tipo: 'TODOS',
        estado: 'TODOS'
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
        await this.cargarActivos();
        this.initFiltrosListeners();
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
    },

    async cargarActivos() {
        try {
            const sedeId = this.getSedeId();
            
            const resSede = await api.get(`/sede/${sedeId}`);
            this.sedeActualInfo = resSede.data || { NombreComercial: "Sede Central" };

            const res = await api.get(`/activos/${sedeId}`);
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

        grid.innerHTML = activosFiltrados.map(a => {
            const necesitaReingreso = (a.Estado === 'EN TRÁNSITO' || a.Estado === 'EN MANTENIMIENTO');
            return `
                <div class="card-activo" style="border: 1px solid #ccc; padding: 20px; border-radius: 20px; text-align: center; background: var(--hotel-bg); box-shadow: 6px 6px 12px var(--hotel-shadow-dark);">
                    <h3 style="margin-top:0; color: var(--hotel-blue); font-size: 1.1rem; text-transform: uppercase;">${a.Nombre}</h3>
                    <div id="qr-${a.ActivoID}" class="qr-container" style="width: 100px; height: 100px; margin: 15px auto; background: white; padding: 5px; border-radius: 10px;"></div>
                    <p style="margin: 5px 0; font-size: 0.85rem;"><strong>SERIE:</strong> ${a.SeriePlaca || 'S/N'}</p>
                    <p style="margin: 5px 0; font-size: 0.85rem;"><strong>ESTADO:</strong> <span style="color:var(--hotel-gold)">${a.Estado || 'OPERATIVO'}</span></p>
                    <div style="display:flex; flex-direction:column; gap:10px; margin-top:15px;">
                        ${necesitaReingreso ? `
                            <button class="btn-neo no-print" style="justify-content:center; background: #27ae60; color: white;" onclick="ActivosModule.abrirModalReingreso(${a.ActivoID})">
                                <i class="fas fa-check-circle"></i> CONFIRMAR RECEPCIÓN
                            </button>
                        ` : `
                            <button class="btn-neo no-print" style="justify-content:center;" onclick="ActivosModule.abrirModalMovimiento(${a.ActivoID})">
                                <i class="fas fa-exchange-alt"></i> REGISTRAR SALIDA
                            </button>
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

    async imprimirReporteOficial(tipoFiltro = 'TODOS') {
        const datos = (tipoFiltro === 'TODOS') 
            ? this.activosCache 
            : this.activosCache.filter(a => a.TipoID == tipoFiltro);

        const totalAcumulado = datos.reduce((sum, a) => sum + parseFloat(a.ValorCompra || 0), 0);

        let logoUrl = '';
        if (this.sedeActualInfo && this.sedeActualInfo.LogoPath) {
            const fileName = this.sedeActualInfo.LogoPath.split(/[\\/]/).pop();
            logoUrl = `${window.AppConfig.apiUrl}/uploads/sedes/logos/${fileName}`;
        }

        const fecha = new Date().toLocaleString();
        const ventana = window.open('', '_blank', 'width=900,height=800');
        
        ventana.document.write(`
            <html>
                <head>
                    <title>Reporte de Activos</title>
                    <style>
                        body { font-family: sans-serif; padding: 40px; color: #333; }
                        header { display: flex; justify-content: space-between; border-bottom: 2px solid #1a365d; padding-bottom: 20px; align-items: center; }
                        .logo { max-height: 80px; }
                        table { width: 100%; border-collapse: collapse; margin-top: 30px; }
                        th { background: #f2f2f2; padding: 10px; border: 1px solid #ccc; text-align: left; }
                        td { padding: 10px; border: 1px solid #ccc; font-size: 0.9rem; }
                        .total-row { font-weight: bold; background: #e8e8e8; }
                        .firmas { display: flex; justify-content: space-between; margin-top: 100px; }
                        .linea { width: 220px; border-top: 1px solid #000; text-align: center; padding-top: 10px; font-weight: bold; }
                    </style>
                </head>
                <body onload="setTimeout(() => { window.print(); }, 800)">
                    <header>
                        ${logoUrl ? `<img src="${logoUrl}" class="logo">` : '<div></div>'}
                        <div style="text-align:right;">
                            <h2 style="margin:0;">${this.sedeActualInfo.NombreComercial}</h2>
                            <p style="margin:5px 0;">Reporte de Inventario de Activos</p>
                            <small>Generado: ${fecha}</small>
                        </div>
                    </header>
                    <table>
                        <thead><tr><th>Nombre</th><th>Serie</th><th>Estado</th><th>Valor</th></tr></thead>
                        <tbody>
                            ${datos.map(a => `
                                <tr>
                                    <td>${a.Nombre}</td>
                                    <td>${a.SeriePlaca || 'S/N'}</td>
                                    <td>${a.Estado || 'OPERATIVO'}</td>
                                    <td>$${parseFloat(a.ValorCompra || 0).toFixed(2)}</td>
                                </tr>`).join('')}
                            <tr class="total-row">
                                <td colspan="3" style="text-align: right;">TOTAL GENERAL</td>
                                <td>$${totalAcumulado.toFixed(2)}</td>
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
        } else if (this.modoActual === 'MOVIMIENTO') {
            await this.registrarMovimiento();
        } else if (this.modoActual === 'REINGRESO') {
            await this.confirmarReingreso();
        }
    },

    async guardar() {
        const payload = {
            Nombre: document.getElementById('nombre-input').value.trim(),
            SeriePlaca: document.getElementById('serie-input').value.trim(),
            ValorCompra: parseFloat(document.getElementById('valor-input').value) || 0,
            TipoID: parseInt(document.getElementById('tipo-input').value),
            SedeActualID: parseInt(this.getSedeId())
        };

        if (!payload.Nombre || isNaN(payload.TipoID)) {
            return alert("Nombre y Tipo de Activo son obligatorios.");
        }

        try {
            await api.post('/activos', payload);
            this.cerrarModal();
            await this.cargarActivos();
        } catch (err) {
            console.error("Error al guardar activo:", err);
            alert("Error al guardar activo.");
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
        document.getElementById('form-registro').style.display = 'block';
        document.getElementById('form-movimiento').style.display = 'none';
        if (document.getElementById('historial-movimientos-container')) {
            document.getElementById('historial-movimientos-container').style.display = 'none';
        }
        document.getElementById('modal-activos').classList.remove('modal-hidden');
    },

    async abrirModalMovimiento(id) {
        this.modoActual = 'MOVIMIENTO';
        this.limpiarFormulario();
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

    limpiarFormulario() {
        ['nombre-input', 'serie-input', 'valor-input', 'activoId-input', 'obs-input', 'sede-destino-input', 'responsable-input'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const comboMov = document.getElementById('tipo-mov-input');
        if (comboMov) {
            comboMov.value = 'TRASLADO';
            comboMov.style.display = 'block';
        }
    }
};

module.exports = ActivosModule;