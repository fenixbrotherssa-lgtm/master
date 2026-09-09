const api = require('./api');

const CocinaMovilModule = {
    pendientes: [],
    entregados: [],
    pedidosPos: [],
    sedeId: null,

    async init() {
        console.log('🍳 Módulo Cocina iniciado...');
        const user = JSON.parse(localStorage.getItem('user'));
        this.sedeId = localStorage.getItem('currentSedeId') || user?.SedeID;

        const label = document.getElementById('cocina-sede-label');
        if (label) label.textContent = `Sede ${this.sedeId}`;

        await this.cargarPedidos();
        this.setupSocket();
        window.CocinaMovilModule = this;
    },

    async cargarPedidos() {
        try {
            const res = await api.get(`/restaurante/cocina/${this.sedeId}`);
            const todos = res.data;
            this.pendientes = todos.filter(p => p.Estado !== 'LISTO');
            this.entregados = todos.filter(p => p.Estado === 'LISTO');
            this.renderPedidos();
        } catch (err) {
            console.error('Error cargando pedidos cocina', err);
        }
    },

    renderPedidos() {
        this.renderPendientes();
        this.renderEntregados();
        this.renderPos();
    },

    renderPendientes() {
        const lista = document.getElementById('lista-pedidos-cocina');
        const badge = document.getElementById('cocina-badge-total');
        if (!lista) return;

        if (badge) badge.textContent = this.pendientes.length;

        if (this.pendientes.length === 0) {
            lista.innerHTML = `
                <p style="text-align:center; opacity:0.4; margin-top:30px; font-size:0.9rem;">
                    <i class="fas fa-check-circle" style="font-size:3rem; display:block; margin-bottom:15px; color:#27ae60;"></i>
                    Sin pedidos pendientes
                </p>`;
            return;
        }

        lista.innerHTML = this.pendientes.map(p => {
            const enPrep = p.Estado === 'EN_PREPARACION';
            const claseCard = enPrep ? 'en-preparacion' : 'solicitado';
            const tiempo = this.tiempoDesdeMinutos(p.MinutosTranscurridos);

            const boton = enPrep
                ? `<button class="btn-cocina btn-listo" onclick="CocinaMovilModule.cambiarEstado(${p.DetalleID}, 'LISTO')">
                       <i class="fas fa-check"></i> LISTO
                   </button>`
                : `<button class="btn-cocina btn-preparar" onclick="CocinaMovilModule.cambiarEstado(${p.DetalleID}, 'EN_PREPARACION')">
                       <i class="fas fa-fire"></i> PREPARANDO
                   </button>`;

            return `
                <div class="card-pedido ${claseCard}" id="pedido-${p.DetalleID}">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
                        <div>
                            <div style="font-size:0.65rem; font-weight:900; color:#718096; text-transform:uppercase; margin-bottom:4px;">
                                <span style="background:#1a365d; color:white; border-radius:6px; padding:2px 7px; margin-right:6px;">#${p.NroOrden}</span>MESA ${p.NroMesa}
                            </div>
                            <div style="font-size:1.1rem; font-weight:900; color:#1a365d;">${p.NombreProducto}</div>
                            <div style="font-size:0.85rem; color:#718096; margin-top:2px;">Cantidad: <strong>${p.Cantidad}</strong> &nbsp;·&nbsp; <i class="fas fa-user"></i> ${p.NombreUsuario || ''}</div>
                        </div>
                        <div style="text-align:right;">
                            <div class="tiempo-badge"><i class="far fa-clock"></i> ${tiempo}</div>
                            <div style="margin-top:6px; font-size:0.7rem; font-weight:900; color:${enPrep ? '#f39c12' : '#e74c3c'};">
                                ${enPrep ? 'EN PREPARACIÓN' : 'SOLICITADO'}
                            </div>
                        </div>
                    </div>
                    <div>${boton}</div>
                </div>
            `;
        }).join('');
    },

    renderEntregados() {
        const lista = document.getElementById('lista-entregados-cocina');
        const badge = document.getElementById('cocina-badge-entregados');
        if (!lista) return;

        if (badge) badge.textContent = this.entregados.length;

        if (this.entregados.length === 0) {
            lista.innerHTML = `<p style="text-align:center; opacity:0.3; font-size:0.8rem; padding:15px 0;">Sin entregas aún</p>`;
            return;
        }

        lista.innerHTML = this.entregados.map(p => `
            <div class="card-entregado">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <span style="font-size:0.65rem; font-weight:900; color:#718096;">
                            <span style="background:#27ae60; color:white; border-radius:6px; padding:2px 7px; margin-right:6px;">#${p.NroOrden}</span>MESA ${p.NroMesa}
                        </span>
                        <div style="font-size:0.95rem; font-weight:700; color:#2d3748;">${p.NombreProducto}</div>
                        <span style="font-size:0.8rem; color:#718096;">x${p.Cantidad}</span>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:0.7rem; font-weight:900; color:#27ae60;"><i class="fas fa-check-circle"></i> ENTREGADO</div>
                        <div style="font-size:0.65rem; color:#a0aec0; margin-top:3px;">hace ${this.tiempoDesdeMinutos(p.MinutosTranscurridos)}</div>
                    </div>
                </div>
            </div>
        `).join('');
    },

    async cambiarEstado(detalleId, nuevoEstado) {
        try {
            await api.put(`/restaurante/detalle/${detalleId}/estado`, { estado: nuevoEstado });
            if (nuevoEstado === 'LISTO') {
                const item = this.pendientes.find(p => p.DetalleID === detalleId);
                if (item) {
                    item.Estado = 'LISTO';
                    item.MinutosTranscurridos = 0;
                    this.pendientes = this.pendientes.filter(p => p.DetalleID !== detalleId);
                    this.entregados.unshift(item);
                }
            } else {
                const p = this.pendientes.find(p => p.DetalleID === detalleId);
                if (p) p.Estado = nuevoEstado;
            }
            this.renderPedidos();
        } catch (err) {
            console.error('Error cambiando estado', err);
        }
    },

    tiempoDesdeMinutos(mins) {
        if (!mins || mins < 1) return 'Ahora';
        if (mins < 60) return `${mins} min`;
        return `${Math.floor(mins / 60)}h ${mins % 60}m`;
    },

    renderPos() {
        const lista = document.getElementById('lista-pos-cocina');
        const seccion = document.getElementById('seccion-pos-cocina');
        if (!lista || !seccion) return;

        const hayDatos = this.pedidosPos.length > 0 || this.pedidosPosEntregados.length > 0;
        seccion.style.display = hayDatos ? 'block' : 'none';

        let html = this.pedidosPos.map((p, idx) => `
            <div class="card-pedido" style="border-left:5px solid #2980b9;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
                    <div>
                        <div style="font-size:0.65rem; font-weight:900; color:#2980b9; text-transform:uppercase; margin-bottom:4px;">
                            <i class="fas fa-concierge-bell"></i> ${p.origen}
                        </div>
                        <div style="font-size:1.1rem; font-weight:900; color:#1a365d;">${p.nombreProducto}</div>
                        <div style="font-size:0.85rem; color:#718096; margin-top:2px;">Cantidad: <strong>${p.cantidad}</strong></div>
                    </div>
                    <div style="font-size:0.65rem; font-weight:900; color:#2980b9;">ROOM SERVICE</div>
                </div>
                <button class="btn-cocina" style="background:#2980b9; color:white;" onclick="CocinaMovilModule.prepararPos(${idx})">
                    <i class="fas fa-check"></i> PREPARADO
                </button>
            </div>
        `).join('');

        if (this.pedidosPosEntregados.length > 0) {
            html += `<div style="font-size:0.65rem; font-weight:900; color:#2980b9; opacity:0.7; margin:12px 0 8px; letter-spacing:1px;">
                <i class="fas fa-check-circle"></i> PREPARADOS ROOM SERVICE (${this.pedidosPosEntregados.length})
            </div>`;
            html += this.pedidosPosEntregados.map(p => `
                <div class="card-entregado" style="border-left:3px solid #2980b9; opacity:0.8;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <span style="font-size:0.65rem; font-weight:900; color:#2980b9;"><i class="fas fa-concierge-bell"></i> ${p.origen}</span>
                            <div style="font-size:0.9rem; font-weight:700; color:#2d3748;">${p.nombreProducto} x${p.cantidad}</div>
                        </div>
                        <i class="fas fa-check-circle" style="color:#2980b9; font-size:1.2rem;"></i>
                    </div>
                </div>
            `).join('');
        }

        lista.innerHTML = html;
    },

    prepararPos(idx) {
        const item = this.pedidosPos.splice(idx, 1)[0];
        if (item) this.pedidosPosEntregados.unshift(item);
        this.renderPos();
    },

    pedidosPosEntregados: [],

    setupSocket() {
        if (!window.socket) return;

        window.socket.on('cocina:pedido_nuevo', () => {
            if (window.Alertas) window.Alertas.notificar('cocina', 'Nuevo pedido en cocina');
            this.cargarPedidos();
            if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        });

        window.socket.on('cocina:estado_cambio', () => {
            this.cargarPedidos();
        });

        window.socket.on('cocina:pedido_pos', (data) => {
            if (window.Alertas) window.Alertas.notificar('cocina', `Nuevo pedido de room service${data && data.nombreProducto ? ': ' + data.nombreProducto : ''}`);
            this.pedidosPos.push(data);
            this.renderPos();
            if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
        });
    }
};

module.exports = CocinaMovilModule;
