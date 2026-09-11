const api = require('./api');

const PersonalModule = {
    _sedeId: null,
    _personal: [],
    _nominaData: null,
    _nombreSede: 'MasterHotel',

    async init() {
        window.PersonalModule = this;
        const user = JSON.parse(localStorage.getItem('user'));
        this._sedeId = localStorage.getItem('currentSedeId') || user?.SedeID || 1;

        // Período por defecto = mes actual
        const hoy = new Date();
        const periodoEl = document.getElementById('ps-periodo');
        if (periodoEl) periodoEl.value = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}`;

        // Obtener nombre del hotel para los comprobantes
        try {
            const resSedes = await api.get('/admin/sedes');
            const sede = (resSedes.data || []).find(s => String(s.SedeID) === String(this._sedeId));
            if (sede) this._nombreSede = sede.NombreComercial || 'MasterHotel';
        } catch (_) {}

        await this.cargarPersonal();
        await this.cargarMetodosYRubros();
    },

    async cargarMetodosYRubros() {
        try {
            const [resMetodos, resRubros] = await Promise.all([
                api.get('/reportes/metodos-pago'),
                api.get('/reportes/rubros')
            ]);
            this.metodosPagoCache = resMetodos.data || [];
            this.rubrosEgresoCache = (resRubros.data || []).filter(r => r.Tipo === 'Egreso');

            const selMetodo = document.getElementById('ps-mov-metodo');
            if (selMetodo) selMetodo.innerHTML = this.metodosPagoCache.map(m => `<option value="${m.MetodoID}">${m.Nombre}</option>`).join('');

            const selRubro = document.getElementById('ps-mov-rubro');
            if (selRubro) {
                selRubro.innerHTML = this.rubrosEgresoCache.map(r => `<option value="${r.RubroID}" ${r.Nombre.includes('Nómina') ? 'selected' : ''}>${r.Nombre}</option>`).join('');
            }
        } catch (err) {
            console.error('Error cargando métodos/rubros:', err);
        }
    },

    togglePagoMovimiento() {
        const tipo = document.getElementById('ps-mov-tipo').value;
        const wrap = document.getElementById('ps-mov-pago-wrap');
        const esDescuento = tipo === 'DESCUENTO';
        wrap.style.display = esDescuento ? 'none' : 'block';
        if (!esDescuento) this.togglePagoCampos();
    },

    togglePagoCampos() {
        const activo = document.getElementById('ps-mov-registrar-pago').checked;
        document.getElementById('ps-mov-pago-campos').style.display = activo ? 'flex' : 'none';
    },

    async cargarPersonal() {
        const tabla = document.getElementById('ps-tabla');
        if (!tabla) return;
        tabla.innerHTML = `<div style="text-align:center;padding:30px;color:#718096;"><i class="fas fa-spinner fa-spin"></i> Cargando...</div>`;
        try {
            const res = await api.get(`/personal/lista/${this._sedeId}`);
            this._personal = res.data.personal || [];
            this._renderTabla();
        } catch (_) {
            if (document.getElementById('ps-tabla'))
                document.getElementById('ps-tabla').innerHTML = `<p style="color:#e74c3c;padding:20px">Error cargando personal.</p>`;
        }
    },

    _renderTabla() {
        const tabla = document.getElementById('ps-tabla');
        if (!tabla) return;
        if (!this._personal.length) {
            tabla.innerHTML = `<p style="text-align:center;color:#718096;padding:30px;">No hay empleados registrados.</p>`;
            return;
        }
        const filas = this._personal.map(p => {
            const adelantos = parseFloat(p.TotalAdelantos || 0);
            return `
            <tr>
                <td>
                    <div style="font-weight:800">${p.NombreCompleto}</div>
                    <div style="font-size:.7rem;color:#718096">${p.Cedula || '—'}</div>
                    ${p.AfiliadoIESS ? '<span style="font-size:.6rem; font-weight:800; color:#27ae60;"><i class="fas fa-shield-alt"></i> IESS</span>' : ''}
                </td>
                <td style="font-size:.8rem">${p.Cargo || '—'}</td>
                <td style="font-weight:800;color:#27ae60">$${parseFloat(p.SalarioBase).toFixed(2)}</td>
                <td style="font-weight:800;color:${adelantos > 0 ? '#e74c3c' : '#27ae60'}">
                    ${adelantos > 0 ? `-$${adelantos.toFixed(2)}` : '$0.00'}
                </td>
                <td style="font-size:.75rem;color:#718096">${p.Telefono || '—'}</td>
                <td>
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                        <button class="btn-neo btn-sm btn-prim" onclick="PersonalModule.abrirModalEmpleado(${p.PersonalID})" title="Editar">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-neo btn-sm btn-gold" onclick="PersonalModule.abrirModalMovimiento(${p.PersonalID},'${p.NombreCompleto.replace(/'/g,"\\'")}')" title="Adelanto/Bono">
                            <i class="fas fa-exchange-alt"></i>
                        </button>
                        <button class="btn-neo btn-sm" style="background:#718096;color:white" onclick="PersonalModule.verHistorial(${p.PersonalID},'${p.NombreCompleto.replace(/'/g,"\\'")}')" title="Historial">
                            <i class="fas fa-history"></i>
                        </button>
                        <button class="btn-neo btn-sm btn-danger" onclick="PersonalModule.abrirLiquidacion(${p.PersonalID})" title="Liquidación final (finiquito)">
                            <i class="fas fa-file-invoice-dollar"></i>
                        </button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        tabla.innerHTML = `
        <table class="ps-table">
            <thead><tr>
                <th>Empleado</th><th>Cargo</th><th>Salario Base</th>
                <th>Adelantos</th><th>Teléfono</th><th>Acciones</th>
            </tr></thead>
            <tbody>${filas}</tbody>
        </table>`;
    },

    abrirModalEmpleado(id = null) {
        const emp = id ? this._personal.find(p => p.PersonalID === id) : null;
        document.getElementById('ps-modal-titulo').innerHTML =
            `<i class="fas fa-user-edit" style="color:var(--gold)"></i> ${emp ? 'Editar Empleado' : 'Nuevo Empleado'}`;
        document.getElementById('ps-emp-id').value      = emp?.PersonalID  || '';
        document.getElementById('ps-emp-nombre').value  = emp?.NombreCompleto || '';
        document.getElementById('ps-emp-cedula').value  = emp?.Cedula       || '';
        document.getElementById('ps-emp-cargo').value   = emp?.Cargo        || '';
        document.getElementById('ps-emp-salario').value = emp?.SalarioBase   || '';
        document.getElementById('ps-emp-ingreso').value = emp?.FechaIngreso?.slice(0,10) || '';
        document.getElementById('ps-emp-tel').value     = emp?.Telefono     || '';
        document.getElementById('ps-emp-correo').value  = emp?.Correo       || '';
        document.getElementById('ps-emp-iess').checked  = !!emp?.AfiliadoIESS;
        document.getElementById('ps-emp-d13').checked   = !!emp?.DecimoTerceroMensualizado;
        document.getElementById('ps-emp-d14').checked   = !!emp?.DecimoCuartoMensualizado;
        document.getElementById('ps-emp-fr').checked    = !!emp?.FondoReservaMensualizado;
        const btnDes = document.getElementById('ps-btn-desactivar');
        if (btnDes) btnDes.style.display = emp ? 'inline-flex' : 'none';
        document.getElementById('ps-overlay-emp').classList.add('visible');
    },

    abrirModalMovimiento(pid, nombre) {
        document.getElementById('ps-mov-pid').value   = pid;
        document.getElementById('ps-mov-titulo').innerHTML =
            `<i class="fas fa-exchange-alt" style="color:var(--gold)"></i> Movimiento — ${nombre}`;
        document.getElementById('ps-mov-tipo').value  = 'ADELANTO';
        document.getElementById('ps-mov-monto').value = '';
        document.getElementById('ps-mov-horas').value = '';
        document.getElementById('ps-mov-horas-preview').textContent = '';
        document.getElementById('ps-mov-desc').value  = '';
        document.getElementById('ps-mov-registrar-pago').checked = true;
        const hoy = new Date();
        document.getElementById('ps-mov-periodo').value = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}`;
        this.toggleTipoMovimiento();
        document.getElementById('ps-overlay-mov').classList.add('visible');
    },

    toggleTipoMovimiento() {
        const tipo = document.getElementById('ps-mov-tipo').value;
        const esHoras = tipo === 'HORAS_SUPLEMENTARIAS' || tipo === 'HORAS_EXTRAORDINARIAS';
        document.getElementById('ps-mov-monto-wrap').style.display = esHoras ? 'none' : 'flex';
        document.getElementById('ps-mov-horas-wrap').style.display = esHoras ? 'flex' : 'none';
        if (esHoras) this.calcularPreviewHoras();
        this.togglePagoMovimiento();
    },

    calcularPreviewHoras() {
        const pid = document.getElementById('ps-mov-pid').value;
        const tipo = document.getElementById('ps-mov-tipo').value;
        const horas = parseFloat(document.getElementById('ps-mov-horas').value) || 0;
        const emp = this._personal.find(p => String(p.PersonalID) === String(pid));
        const preview = document.getElementById('ps-mov-horas-preview');
        if (!emp || !horas) { preview.textContent = ''; return; }

        const valorHora = parseFloat(emp.SalarioBase) / 240;
        const recargo = tipo === 'HORAS_EXTRAORDINARIAS' ? 2.0 : 1.5;
        const monto = horas * valorHora * recargo;
        preview.textContent = `${horas}h × $${valorHora.toFixed(4)}/h × ${recargo === 2 ? '100%' : '50%'} recargo = $${monto.toFixed(2)}`;
    },

    async verHistorial(id, nombre) {
        document.getElementById('ps-hist-titulo').innerHTML =
            `<i class="fas fa-history" style="color:var(--gold)"></i> Historial — ${nombre}`;
        document.getElementById('ps-hist-contenido').innerHTML =
            `<div style="text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin"></i></div>`;
        document.getElementById('ps-overlay-hist').classList.add('visible');
        try {
            const res  = await api.get(`/personal/${id}/historial`);
            const movs = res.data.movimientos || [];
            if (!movs.length) {
                document.getElementById('ps-hist-contenido').innerHTML =
                    `<p style="text-align:center;color:#718096;padding:20px;">Sin movimientos registrados.</p>`;
                return;
            }
            const tipoColor = { ADELANTO:'#e74c3c', BONO:'#27ae60', DESCUENTO:'#f39c12', PAGO_NOMINA:'#3498db', HORAS_SUPLEMENTARIAS:'#8e44ad', HORAS_EXTRAORDINARIAS:'#8e44ad', LIQUIDACION_FINAL:'#c0392b' };
            const tiposPositivos = ['BONO', 'PAGO_NOMINA', 'HORAS_SUPLEMENTARIAS', 'HORAS_EXTRAORDINARIAS'];
            document.getElementById('ps-hist-contenido').innerHTML = movs.map(m => {
                const esDescuento = m.Tipo === 'DESCUENTO';
                const badgeCaja = esDescuento
                    ? '<span style="font-size:.6rem; color:#718096;">(no mueve caja)</span>'
                    : m.CajaMovimientoID
                        ? `<span style="font-size:.6rem; font-weight:800; color:#27ae60;" title="Movimiento #${m.CajaMovimientoID}"><i class="fas fa-check-circle"></i> ${m.MetodoPagoNombre || 'PAGADO'}</span>`
                        : '<span style="font-size:.6rem; font-weight:800; color:#e67e22;"><i class="fas fa-exclamation-triangle"></i> SIN REGISTRAR EN CAJA</span>';
                return `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #ddd;">
                    <div>
                        <span style="background:${tipoColor[m.Tipo]||'#718096'};color:white;padding:3px 9px;border-radius:20px;font-size:.65rem;font-weight:900">${m.Tipo.replace('_',' ')}</span>
                        <span style="font-size:.78rem;color:#2c3e50;margin-left:8px">${m.Descripcion || '—'}</span>
                        <div style="font-size:.7rem;color:#718096;margin-top:3px">${m.FechaFmt || ''} ${m.Periodo ? '· Período: '+m.Periodo : ''}</div>
                        <div style="margin-top:4px;">${badgeCaja}</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div style="font-weight:900;font-size:1rem;color:${tipoColor[m.Tipo]||'#718096'}">
                            ${tiposPositivos.includes(m.Tipo) ? '+' : '-'}$${parseFloat(m.Monto).toFixed(2)}
                        </div>
                        ${m.Tipo !== 'PAGO_NOMINA' ? `<button class="btn-neo btn-sm" style="color:#e74c3c" onclick="PersonalModule.eliminarMovimiento(${m.MovimientoID}, ${m.PersonalID})" title="Eliminar movimiento">
                            <i class="fas fa-trash"></i>
                        </button>` : ''}
                    </div>
                </div>`;
            }).join('');
        } catch (_) {
            document.getElementById('ps-hist-contenido').innerHTML =
                `<p style="color:#e74c3c;padding:20px">Error cargando historial.</p>`;
        }
    },

    async eliminarMovimiento(movimientoId, personalId) {
        const conf = await Swal.fire({
            icon: 'warning', title: '¿Eliminar este movimiento?',
            text: 'Si estaba registrado en Caja, también se elimina ese egreso. Esta acción no se puede deshacer.',
            showCancelButton: true, confirmButtonText: 'Sí, eliminar', confirmButtonColor: '#e74c3c', cancelButtonText: 'Cancelar'
        });
        if (!conf.isConfirmed) return;
        try {
            await api.delete(`/personal/movimiento/${movimientoId}`);
            Swal.fire({ icon: 'success', title: 'Movimiento eliminado', timer: 1500, showConfirmButton: false });
            const nombre = this._personal.find(p => String(p.PersonalID) === String(personalId))?.NombreCompleto;
            await this.verHistorial(personalId, nombre);
            await this.cargarPersonal();
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: e.response?.data?.error || e.message, confirmButtonColor: '#1a365d' });
        }
    },

    cerrarModales() {
        ['ps-overlay-emp','ps-overlay-mov','ps-overlay-hist'].forEach(id => {
            document.getElementById(id)?.classList.remove('visible');
        });
    },

    async guardarEmpleado() {
        const nombre  = document.getElementById('ps-emp-nombre').value.trim();
        if (nombre.length < 3) return Swal.fire({ icon:'warning', title:'Ingresa el nombre completo', confirmButtonColor:'#1a365d' });
        try {
            await api.post('/personal/guardar', {
                personalId:    document.getElementById('ps-emp-id').value     || undefined,
                sedeId:        this._sedeId,
                nombreCompleto: nombre,
                cedula:        document.getElementById('ps-emp-cedula').value.trim()  || undefined,
                cargo:         document.getElementById('ps-emp-cargo').value.trim()   || undefined,
                salarioBase:   document.getElementById('ps-emp-salario').value        || 0,
                fechaIngreso:  document.getElementById('ps-emp-ingreso').value        || undefined,
                telefono:      document.getElementById('ps-emp-tel').value.trim()     || undefined,
                correo:        document.getElementById('ps-emp-correo').value.trim()  || undefined,
                afiliadoIESS:              document.getElementById('ps-emp-iess').checked,
                decimoTerceroMensualizado: document.getElementById('ps-emp-d13').checked,
                decimoCuartoMensualizado:  document.getElementById('ps-emp-d14').checked,
                fondoReservaMensualizado:  document.getElementById('ps-emp-fr').checked
            });
            this.cerrarModales();
            Swal.fire({ icon:'success', title:'Empleado guardado', timer:1800, showConfirmButton:false });
            await this.cargarPersonal();
        } catch (e) {
            Swal.fire({ icon:'error', title:'Error', text: e.response?.data?.error || e.message, confirmButtonColor:'#1a365d' });
        }
    },

    async desactivarEmpleado() {
        const id = document.getElementById('ps-emp-id').value;
        if (!id) return;
        const conf = await Swal.fire({ icon:'warning', title:'¿Desactivar empleado?', showCancelButton:true,
            confirmButtonText:'Sí, desactivar', confirmButtonColor:'#e74c3c', cancelButtonText:'Cancelar' });
        if (!conf.isConfirmed) return;
        try {
            await api.delete(`/personal/${id}`);
            this.cerrarModales();
            Swal.fire({ icon:'success', title:'Empleado desactivado', timer:1800, showConfirmButton:false });
            await this.cargarPersonal();
        } catch (e) {
            Swal.fire({ icon:'error', title:'Error', text: e.response?.data?.error || e.message, confirmButtonColor:'#1a365d' });
        }
    },

    async guardarMovimiento() {
        const pid     = document.getElementById('ps-mov-pid').value;
        const tipo    = document.getElementById('ps-mov-tipo').value;
        const desc    = document.getElementById('ps-mov-desc').value.trim();
        const periodo = document.getElementById('ps-mov-periodo').value;
        const esHoras = tipo === 'HORAS_SUPLEMENTARIAS' || tipo === 'HORAS_EXTRAORDINARIAS';

        const monto = parseFloat(document.getElementById('ps-mov-monto').value);
        const horas = parseFloat(document.getElementById('ps-mov-horas').value);
        if (esHoras) {
            if (!horas || horas <= 0) return Swal.fire({ icon:'warning', title:'Ingresa una cantidad de horas válida', confirmButtonColor:'#1a365d' });
        } else if (!monto || monto <= 0) {
            return Swal.fire({ icon:'warning', title:'Ingresa un monto válido', confirmButtonColor:'#1a365d' });
        }

        const registrarPago = tipo !== 'DESCUENTO' && document.getElementById('ps-mov-registrar-pago').checked;
        if (registrarPago && !document.getElementById('ps-mov-metodo').value) {
            return Swal.fire({ icon:'warning', title:'Indique de dónde salió el dinero', confirmButtonColor:'#1a365d' });
        }

        try {
            const res = await api.post('/personal/movimiento', {
                personalId: pid, sedeId: this._sedeId, tipo, monto: esHoras ? undefined : monto, horas: esHoras ? horas : undefined,
                descripcion: desc || undefined, periodo: periodo || undefined,
                RegistrarPago: registrarPago,
                MetodoPagoID: registrarPago ? parseInt(document.getElementById('ps-mov-metodo').value) : null,
                RubroID: registrarPago ? parseInt(document.getElementById('ps-mov-rubro').value) : null
            });
            const montoFinal = res.data.montoCalculado ?? monto;
            this.cerrarModales();

            const conf = await Swal.fire({
                icon: 'success', title: 'Movimiento registrado',
                text: '¿Deseas imprimir el comprobante para que el empleado firme?',
                showCancelButton: true, confirmButtonText: '🖨️ Imprimir comprobante',
                cancelButtonText: 'No, cerrar', confirmButtonColor: '#1a365d'
            });

            if (conf.isConfirmed) {
                const emp = this._personal.find(p => String(p.PersonalID) === String(pid)) || {};
                this._imprimirComprobanteMovimiento({ emp, tipo, monto: montoFinal, desc, periodo });
            }
            await this.cargarPersonal();
        } catch (e) {
            Swal.fire({ icon:'error', title:'Error', text: e.response?.data?.error || e.message, confirmButtonColor:'#1a365d' });
        }
    },

    _imprimirComprobanteMovimiento({ emp, tipo, monto, desc, periodo }) {
        const titulos = { ADELANTO:'COMPROBANTE DE ADELANTO DE NÓMINA', BONO:'COMPROBANTE DE BONO / INCENTIVO',
                          DESCUENTO:'COMPROBANTE DE DESCUENTO', PAGO_NOMINA:'COMPROBANTE DE PAGO',
                          HORAS_SUPLEMENTARIAS:'COMPROBANTE DE HORAS SUPLEMENTARIAS (+50%)',
                          HORAS_EXTRAORDINARIAS:'COMPROBANTE DE HORAS EXTRAORDINARIAS (+100%)' };
        const notas   = { ADELANTO:'El empleado confirma haber recibido el adelanto indicado, el cual será descontado de su próxima nómina.',
                          BONO:'El empleado confirma haber recibido el bono/incentivo indicado.',
                          DESCUENTO:'Se aplica el descuento según lo acordado entre las partes.',
                          PAGO_NOMINA:'El empleado confirma haber recibido conforme el pago detallado.',
                          HORAS_SUPLEMENTARIAS:'El empleado confirma haber recibido el pago de horas suplementarias indicado (Art. 55 Código de Trabajo).',
                          HORAS_EXTRAORDINARIAS:'El empleado confirma haber recibido el pago de horas extraordinarias indicado (Art. 55 Código de Trabajo).' };
        const signo   = (tipo === 'BONO' || tipo === 'PAGO_NOMINA' || tipo === 'HORAS_SUPLEMENTARIAS' || tipo === 'HORAS_EXTRAORDINARIAS') ? '+' : '-';
        const fecha   = new Date().toLocaleDateString('es-EC', { day:'2-digit', month:'long', year:'numeric' });

        const html = this._tplComprobante({
            titulo:  titulos[tipo] || 'COMPROBANTE',
            periodo: periodo ? `Período: ${periodo}` : `Fecha: ${fecha}`,
            emp,
            filas: [
                ['Concepto',  titulos[tipo] || tipo],
                ['Descripción', desc || '—'],
                ['Período',   periodo || fecha],
            ],
            neto:  `${signo}$${parseFloat(monto).toFixed(2)}`,
            fecha,
            nota:  notas[tipo] || ''
        });
        this._abrirVentanaImpresion(html);
    },

    async generarNomina() {
        const periodo = document.getElementById('ps-periodo')?.value;
        if (!periodo) return Swal.fire({ icon:'warning', title:'Selecciona el período', confirmButtonColor:'#1a365d' });
        const res2 = document.getElementById('ps-nomina-resultado');
        if (res2) res2.innerHTML = `<div style="text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin"></i> Calculando...</div>`;
        try {
            const res = await api.post('/personal/nomina', { sedeId: this._sedeId, periodo });
            this._nominaData = res.data;
            this._renderNomina(res.data);
            const btnImp = document.getElementById('ps-btn-imprimir');
            if (btnImp) { btnImp.disabled = false; }
        } catch (e) {
            if (document.getElementById('ps-nomina-resultado'))
                document.getElementById('ps-nomina-resultado').innerHTML =
                    `<p style="color:#e74c3c;padding:20px">Error: ${e.response?.data?.error || e.message}</p>`;
        }
    },

    _renderNomina(data) {
        const cont = document.getElementById('ps-nomina-resultado');
        if (!cont) return;

        let avisoD14 = '';
        const d14 = data.decimoCuarto;
        if (d14 && !d14.regionConfigurada) {
            avisoD14 = `<div style="background:#fdecea; border-left:4px solid #e74c3c; border-radius:8px; padding:10px 14px; margin-bottom:14px; font-size:.78rem; font-weight:700; color:#c0392b;">
                <i class="fas fa-exclamation-triangle"></i> Esta sede no tiene configurada la región del Décimo Cuarto (Costa/Galápagos o Sierra/Amazonía) — se está asumiendo Sierra/Amazonía por defecto.
                Configúrala en <b>Sedes</b> para que la fecha tope sea correcta.
            </div>`;
        } else if (d14 && d14.esMesDePago) {
            avisoD14 = `<div style="background:#fff8e1; border-left:4px solid #f39c12; border-radius:8px; padding:10px 14px; margin-bottom:14px; font-size:.78rem; font-weight:700; color:#b8860b;">
                <i class="fas fa-bell"></i> Este es el mes de pago obligatorio del Décimo Cuarto para esta sede (${d14.region === 'COSTA' ? 'Costa/Galápagos' : 'Sierra/Amazonía'}) — fecha tope ${d14.fechaTope}.
                Si algún empleado no lo tiene mensualizado, recuerda pagarlo aparte este mes.
            </div>`;
        }

        if (!data.nomina.length) {
            cont.innerHTML = avisoD14 + `<p style="text-align:center;color:#718096;padding:20px;">Sin empleados activos para este período.</p>`;
            return;
        }
        const totalNeto = data.nomina.reduce((s, n) => s + n.NetoPagar, 0);
        const filas = data.nomina.map((n, i) => `
            <tr>
                <td>${n.NombreCompleto}</td>
                <td style="font-size:.75rem;color:#718096">${n.Cargo || '—'}</td>
                <td style="color:#27ae60;font-weight:700">$${n.SalarioBase.toFixed(2)}</td>
                <td style="color:#3498db;font-weight:700">${n.Bonos > 0 ? '+$'+n.Bonos.toFixed(2) : '—'}</td>
                <td style="color:#8e44ad;font-weight:700">${n.HorasExtra > 0 ? '+$'+n.HorasExtra.toFixed(2) : '—'}</td>
                <td style="color:#e74c3c;font-weight:700">${n.Adelantos > 0 ? '-$'+n.Adelantos.toFixed(2) : '—'}</td>
                <td style="color:#f39c12;font-weight:700">${n.Descuentos > 0 ? '-$'+n.Descuentos.toFixed(2) : '—'}</td>
                <td style="color:#c0392b;font-weight:700">${n.AporteIessPersonal > 0 ? '-$'+n.AporteIessPersonal.toFixed(2) : '—'}</td>
                <td class="nomina-total">$${n.NetoPagar.toFixed(2)}</td>
                <td>
                    ${n.Pagado
                        ? `<span style="font-size:.65rem; font-weight:900; color:#27ae60;" title="${n.InfoPago?.FechaFmt || ''} · ${n.InfoPago?.MetodoPagoNombre || ''}"><i class="fas fa-check-circle"></i> PAGADO</span>`
                        : `<button class="btn-neo btn-sm btn-green" onclick="PersonalModule.pagarNomina(${i})" title="Pagar neto desde caja">
                               <i class="fas fa-money-check-alt"></i> Pagar
                           </button>`}
                    <button class="btn-neo btn-sm" style="background:#718096;color:white" onclick="PersonalModule.verProvisiones(${i})" title="Ver provisiones (décimos, fondo de reserva, vacaciones)">
                        <i class="fas fa-piggy-bank"></i>
                    </button>
                    <button class="btn-neo btn-sm btn-prim" onclick="PersonalModule.imprimirComprobanteNomina(${i})" title="Imprimir comprobante">
                        <i class="fas fa-print"></i>
                    </button>
                </td>
            </tr>`).join('');

        cont.innerHTML = avisoD14 + `
        <table class="nomina-table">
            <thead><tr>
                <th>Empleado</th><th>Cargo</th><th>Salario Base</th>
                <th>Bonos</th><th>Horas Extra</th><th>Adelantos</th><th>Descuentos</th><th>IESS (9.45%)</th><th>Neto a Pagar</th><th></th>
            </tr></thead>
            <tbody>${filas}</tbody>
            <tfoot>
                <tr>
                    <td colspan="9" style="text-align:right;font-weight:900;padding:14px;font-size:.85rem;">TOTAL NÓMINA ${data.periodo}:</td>
                    <td class="nomina-total" style="padding:14px;background:#d4edda;border-radius:0 12px 12px 0;">$${totalNeto.toFixed(2)}</td>
                </tr>
            </tfoot>
        </table>`;
    },

    async pagarNomina(idx) {
        const n = this._nominaData.nomina[idx];
        const periodo = this._nominaData.periodo;

        if (!this.metodosPagoCache || !this.metodosPagoCache.length) await this.cargarMetodosYRubros();
        const optsMetodo = (this.metodosPagoCache || []).map(m => `<option value="${m.MetodoID}">${m.Nombre}</option>`).join('');
        const optsRubro = (this.rubrosEgresoCache || []).map(r => `<option value="${r.RubroID}" ${r.Nombre.includes('Nómina') ? 'selected' : ''}>${r.Nombre}</option>`).join('');

        const { value: form } = await Swal.fire({
            title: `Pagar Nómina — ${n.NombreCompleto}`,
            html: `
                <p style="font-size:1.3rem; font-weight:900; color:#27ae60; margin-bottom:14px;">$${n.NetoPagar.toFixed(2)}</p>
                <label style="font-size:.75rem; font-weight:800; display:block; text-align:left;">¿De dónde sale el dinero?</label>
                <select id="sw-pago-metodo" class="swal2-select" style="display:block; width:100%; margin:4px 0 12px;">${optsMetodo}</select>
                <label style="font-size:.75rem; font-weight:800; display:block; text-align:left;">Rubro</label>
                <select id="sw-pago-rubro" class="swal2-select" style="display:block; width:100%;">${optsRubro}</select>
            `,
            showCancelButton: true, confirmButtonText: 'Confirmar Pago', confirmButtonColor: '#27ae60',
            preConfirm: () => ({
                MetodoPagoID: parseInt(document.getElementById('sw-pago-metodo').value),
                RubroID: parseInt(document.getElementById('sw-pago-rubro').value)
            })
        });
        if (!form) return;

        try {
            await api.post('/personal/nomina/pagar', { personalId: n.PersonalID, sedeId: this._sedeId, periodo, ...form });
            window.Toast.fire({ icon: 'success', title: 'Nómina pagada' });
            await this.generarNomina();
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: e.response?.data?.error || e.message, confirmButtonColor: '#1a365d' });
        }
    },

    async verHistorialPagos() {
        const periodo = document.getElementById('ps-periodo')?.value;
        try {
            const res = await api.get(`/personal/nomina/pagos/${this._sedeId}`, { params: periodo ? { periodo } : {} });
            const pagos = res.data.pagos || [];
            if (!pagos.length) {
                Swal.fire({ icon: 'info', title: 'Historial de Pagos de Nómina', text: 'Sin pagos registrados' + (periodo ? ` para ${periodo}` : '') + '.' });
                return;
            }
            const filas = pagos.map(p => `
                <tr>
                    <td style="text-align:left; padding:6px 10px;">${p.NombreCompleto}</td>
                    <td style="text-align:center; padding:6px 10px;">${p.Periodo}</td>
                    <td style="text-align:right; padding:6px 10px; font-weight:800; color:#27ae60;">$${parseFloat(p.Monto).toFixed(2)}</td>
                    <td style="text-align:center; padding:6px 10px; font-size:.75rem;">${p.MetodoPagoNombre || '—'}</td>
                    <td style="text-align:center; padding:6px 10px; font-size:.7rem; color:#718096;">${p.FechaFmt}</td>
                </tr>`).join('');
            Swal.fire({
                title: 'Historial de Pagos de Nómina' + (periodo ? ` — ${periodo}` : ''),
                width: 650,
                html: `<div style="max-height:400px; overflow-y:auto;">
                    <table style="width:100%; border-collapse:collapse; font-size:.82rem;">
                        <thead><tr><th style="text-align:left; padding:6px 10px;">Empleado</th><th style="padding:6px 10px;">Período</th><th style="padding:6px 10px;">Monto</th><th style="padding:6px 10px;">Método</th><th style="padding:6px 10px;">Fecha</th></tr></thead>
                        <tbody>${filas}</tbody>
                    </table>
                </div>`
            });
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: e.response?.data?.error || e.message, confirmButtonColor: '#1a365d' });
        }
    },

    async abrirLiquidacion(pid) {
        const emp = this._personal.find(p => p.PersonalID === pid);
        if (!emp) return;

        // Paso 1: tipo de salida + fecha
        const { value: paso1 } = await Swal.fire({
            title: `Liquidación Final — ${emp.NombreCompleto}`,
            html: `
                <label style="font-size:.75rem; font-weight:800; display:block; text-align:left;">Motivo de salida</label>
                <select id="lq-tipo" class="swal2-select" style="display:block; width:100%; margin:4px 0 12px;">
                    <option value="RENUNCIA_VOLUNTARIA">Renuncia voluntaria (Art. 185 — desahucio 25%/año)</option>
                    <option value="DESPIDO_INTEMPESTIVO">Despido intempestivo (Art. 188 — indemnización)</option>
                    <option value="MUTUO_ACUERDO">Mutuo acuerdo (sin indemnización/desahucio)</option>
                    <option value="VISTO_BUENO">Visto bueno / causa justa (sin indemnización/desahucio)</option>
                </select>
                <label style="font-size:.75rem; font-weight:800; display:block; text-align:left;">Fecha de salida</label>
                <input id="lq-fecha" type="date" class="swal2-input" style="width:100%; margin:4px 0;" value="${new Date().toISOString().substring(0,10)}">
                <p style="font-size:.7rem; color:#718096; text-align:left; margin-top:10px;">
                    El siguiente paso calcula décimos/vacaciones/fondo de reserva proporcionales — podrás ajustar cada valor antes de confirmar.
                </p>
            `,
            showCancelButton: true, confirmButtonText: 'Calcular',
            preConfirm: () => ({
                tipoSalida: document.getElementById('lq-tipo').value,
                fechaSalida: document.getElementById('lq-fecha').value
            })
        });
        if (!paso1 || !paso1.fechaSalida) return;

        let calc;
        try {
            Swal.fire({ title: 'Calculando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const res = await api.get('/personal/liquidacion/calcular', { params: { personalId: pid, ...paso1 } });
            Swal.close();
            calc = res.data;
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: e.response?.data?.error || e.message, confirmButtonColor: '#1a365d' });
            return;
        }

        const d = calc.desglose;
        const avisoRegion = !calc.regionConfigurada
            ? `<p style="font-size:.68rem; color:#c0392b; text-align:left; margin-bottom:10px;"><i class="fas fa-exclamation-triangle"></i> Sede sin región de Décimo Cuarto configurada — se asumió Sierra/Amazonía.</p>` : '';

        // Paso 2: desglose editable
        const { value: paso2 } = await Swal.fire({
            title: 'Desglose de Liquidación',
            width: 520,
            html: `
                ${avisoRegion}
                <p style="font-size:.7rem; color:#718096; text-align:left; margin-bottom:10px;">Antigüedad: ${d.antiguedadMeses} meses (${d.aniosCompletos} años completos). Ajusta cualquier valor si el empleado ya tomó vacaciones o recibió fondo de reserva mensualizado en algún tramo.</p>
                <table style="width:100%; font-size:.8rem; text-align:left;">
                    <tr><td style="padding:4px;">Décimo Tercero proporcional</td><td style="padding:4px;"><input id="lq-d13" type="number" step="0.01" class="swal2-input" style="margin:0; width:110px;" value="${d.decimoTerceroProporcional}"></td></tr>
                    <tr><td style="padding:4px;">Décimo Cuarto proporcional</td><td style="padding:4px;"><input id="lq-d14" type="number" step="0.01" class="swal2-input" style="margin:0; width:110px;" value="${d.decimoCuartoProporcional}"></td></tr>
                    <tr><td style="padding:4px;">Vacaciones proporcionales</td><td style="padding:4px;"><input id="lq-vac" type="number" step="0.01" class="swal2-input" style="margin:0; width:110px;" value="${d.vacacionesProporcional}"></td></tr>
                    <tr><td style="padding:4px;">Fondo de Reserva pendiente</td><td style="padding:4px;"><input id="lq-fr" type="number" step="0.01" class="swal2-input" style="margin:0; width:110px;" value="${d.fondoReservaPendiente}"></td></tr>
                    <tr><td style="padding:4px;">Indemnización (Art. 188)</td><td style="padding:4px;"><input id="lq-indem" type="number" step="0.01" class="swal2-input" style="margin:0; width:110px;" value="${d.indemnizacion}"></td></tr>
                    <tr><td style="padding:4px;">Desahucio (Art. 185)</td><td style="padding:4px;"><input id="lq-desah" type="number" step="0.01" class="swal2-input" style="margin:0; width:110px;" value="${d.desahucio}"></td></tr>
                </table>
            `,
            showCancelButton: true, confirmButtonText: 'Continuar',
            preConfirm: () => {
                const vals = ['lq-d13','lq-d14','lq-vac','lq-fr','lq-indem','lq-desah'].map(id => parseFloat(document.getElementById(id).value) || 0);
                return { valores: vals, total: parseFloat(vals.reduce((a,b) => a+b, 0).toFixed(2)) };
            }
        });
        if (!paso2) return;

        const desgloseFinal = {
            decimoTerceroProporcional: paso2.valores[0], decimoCuartoProporcional: paso2.valores[1],
            vacacionesProporcional: paso2.valores[2], fondoReservaPendiente: paso2.valores[3],
            indemnizacion: paso2.valores[4], desahucio: paso2.valores[5]
        };

        // Paso 3: confirmar total, método de pago, y si se desactiva al empleado
        if (!this.metodosPagoCache || !this.metodosPagoCache.length) await this.cargarMetodosYRubros();
        const optsMetodo = (this.metodosPagoCache || []).map(m => `<option value="${m.MetodoID}">${m.Nombre}</option>`).join('');
        const optsRubro = (this.rubrosEgresoCache || []).map(r => `<option value="${r.RubroID}" ${r.Nombre.includes('Nómina') ? 'selected' : ''}>${r.Nombre}</option>`).join('');

        const { value: paso3 } = await Swal.fire({
            title: 'Confirmar Liquidación',
            html: `
                <p style="font-size:1.4rem; font-weight:900; color:#e74c3c; margin-bottom:14px;">TOTAL: $${paso2.total.toFixed(2)}</p>
                <label style="font-size:.75rem; font-weight:800; display:block; text-align:left;">¿De dónde sale el dinero?</label>
                <select id="lq-metodo" class="swal2-select" style="display:block; width:100%; margin:4px 0 12px;">${optsMetodo}</select>
                <label style="font-size:.75rem; font-weight:800; display:block; text-align:left;">Rubro</label>
                <select id="lq-rubro" class="swal2-select" style="display:block; width:100%; margin-bottom:12px;">${optsRubro}</select>
                <label style="display:flex; align-items:center; gap:8px; font-size:.8rem; font-weight:700; cursor:pointer;">
                    <input type="checkbox" id="lq-desactivar" checked style="width:16px; height:16px;"> Desactivar al empleado al confirmar
                </label>
            `,
            showCancelButton: true, confirmButtonText: 'Pagar y Liquidar', confirmButtonColor: '#e74c3c',
            preConfirm: () => ({
                MetodoPagoID: parseInt(document.getElementById('lq-metodo').value),
                RubroID: parseInt(document.getElementById('lq-rubro').value),
                desactivar: document.getElementById('lq-desactivar').checked
            })
        });
        if (!paso3) return;

        try {
            await api.post('/personal/liquidacion', {
                personalId: pid, sedeId: this._sedeId, tipoSalida: paso1.tipoSalida, fechaSalida: paso1.fechaSalida,
                monto: paso2.total, desglose: desgloseFinal, ...paso3
            });
            window.Toast.fire({ icon: 'success', title: 'Liquidación registrada' });
            await this.cargarPersonal();
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: e.response?.data?.error || e.message, confirmButtonColor: '#1a365d' });
        }
    },

    verProvisiones(idx) {
        const n = this._nominaData.nomina[idx];
        const p = this._nominaData.parametros || {};
        const fila = (label, valor, mensualizado, aplica = true) => `
            <tr>
                <td style="text-align:left; padding:6px 10px; font-weight:700;">${label}</td>
                <td style="text-align:right; padding:6px 10px;">${aplica ? '$' + valor.toFixed(2) : '—'}</td>
                <td style="text-align:center; padding:6px 10px; font-size:0.7rem;">
                    ${!aplica ? '<span style="color:#718096;">No aplica aún</span>'
                        : mensualizado ? '<span style="color:#27ae60; font-weight:800;">✓ Sumado al neto</span>'
                        : '<span style="color:#718096;">Acumulado (no se paga este mes)</span>'}
                </td>
            </tr>`;
        Swal.fire({
            title: `Provisiones — ${n.NombreCompleto}`,
            width: 550,
            html: `
                <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
                    <thead><tr><th style="text-align:left; padding:6px 10px;">Beneficio</th><th style="text-align:right; padding:6px 10px;">Acumulado del mes</th><th style="padding:6px 10px;">Estado</th></tr></thead>
                    <tbody>
                        ${fila('Décimo Tercero', n.DecimoTerceroAcumulado, n.DecimoTerceroMensualizado)}
                        ${fila('Décimo Cuarto (SBU $' + (p.SBU || 0).toFixed(2) + '/12)', n.DecimoCuartoAcumulado, n.DecimoCuartoMensualizado)}
                        ${fila('Fondo de Reserva', n.FondoReservaAcumulado, n.FondoReservaMensualizado, n.FondoReservaAplica)}
                        ${fila('Vacaciones', n.VacacionesAcumulado, false, n.AfiliadoIESS)}
                        ${fila('Aporte Patronal IESS', n.AportePatronalIess, false, n.AfiliadoIESS)}
                    </tbody>
                </table>
                <p style="font-size:0.7rem; color:#718096; margin-top:12px; text-align:left;">
                    Antigüedad: ${n.AntiguedadMeses} meses. El Fondo de Reserva aplica desde el mes 13 de servicio continuo (Art. 196 Código de Trabajo).
                    Lo "mensualizado" es elección del empleado — configúralo al editar el empleado.
                </p>
            `
        });
    },

    imprimirComprobanteNomina(idx) {
        if (!this._nominaData) return;
        const n       = this._nominaData.nomina[idx];
        const periodo = this._nominaData.periodo;
        const emp     = this._personal.find(p => p.PersonalID === n.PersonalID) || {};
        const fecha   = new Date().toLocaleDateString('es-EC', { day:'2-digit', month:'long', year:'numeric' });

        // Ingresos: lo que efectivamente incrementa el pago de este mes.
        const filasIngresos = [
            ['Salario Base',                              `$${n.SalarioBase.toFixed(2)}`],
            n.HorasExtra > 0 ? ['(+) Horas suplementarias/extraordinarias', `$${n.HorasExtra.toFixed(2)}`] : null,
            n.Bonos      > 0 ? ['(+) Bonos / Incentivos',                   `$${n.Bonos.toFixed(2)}`]      : null,
            n.DecimoTerceroMensualizado ? ['(+) Décimo Tercero (mensualizado)', `$${n.DecimoTerceroAcumulado.toFixed(2)}`] : null,
            n.DecimoCuartoMensualizado  ? ['(+) Décimo Cuarto (mensualizado)',  `$${n.DecimoCuartoAcumulado.toFixed(2)}`]  : null,
            (n.FondoReservaMensualizado && n.FondoReservaAplica) ? ['(+) Fondo de Reserva (mensualizado)', `$${n.FondoReservaAcumulado.toFixed(2)}`] : null,
        ].filter(Boolean);

        // Deducciones: lo que se resta del pago.
        const filasDeducciones = [
            n.Adelantos           > 0 ? ['(-) Adelantos de nómina',      `$${n.Adelantos.toFixed(2)}`]           : null,
            n.Descuentos          > 0 ? ['(-) Otros descuentos',         `$${n.Descuentos.toFixed(2)}`]          : null,
            n.AporteIessPersonal  > 0 ? [`(-) Aporte Personal IESS (9.45%)`, `$${n.AporteIessPersonal.toFixed(2)}`] : null,
        ].filter(Boolean);

        // Provisiones informativas: se acumulan pero NO se pagan este mes (a menos que estén mensualizadas arriba).
        // Décimos solo se listan aquí si el empleado tiene esa mensualización configurable (checkbox) — si nunca
        // se seleccionó, no se muestran en el recibo impreso (el detalle completo sigue disponible en "Provisiones").
        const filasProvisiones = [
            (n.FondoReservaAplica && !n.FondoReservaMensualizado) ? ['Fondo de Reserva acumulado (no pagado este mes)', `$${n.FondoReservaAcumulado.toFixed(2)}`] : null,
            n.AfiliadoIESS ? ['Vacaciones acumuladas',                     `$${n.VacacionesAcumulado.toFixed(2)}`] : null,
            n.AfiliadoIESS ? ['Aporte Patronal IESS (a cargo del hotel, informativo)', `$${n.AportePatronalIess.toFixed(2)}`] : null,
        ].filter(Boolean);

        const html = this._tplComprobante({
            titulo:   'COMPROBANTE DE PAGO DE NÓMINA',
            periodo:  `Período: ${periodo}${emp.AfiliadoIESS ? ' · Afiliado IESS' : ''}`,
            emp,
            filas: [
                ['INGRESOS', ''],
                ...filasIngresos,
                ['DEDUCCIONES', ''],
                ...(filasDeducciones.length ? filasDeducciones : [['(sin deducciones)', '']]),
                ['PROVISIONES (no pagadas este mes)', ''],
                ...filasProvisiones
            ],
            neto:  `$${n.NetoPagar.toFixed(2)}`,
            fecha,
            nota: 'El empleado confirma haber recibido conforme el pago neto detallado. Las provisiones (décimos, fondo de reserva, vacaciones) se acumulan y se pagan según ley o cuando el empleado las solicite/tome, salvo que estén marcadas como mensualizadas.'
        });
        this._abrirVentanaImpresion(html);
    },

    _abrirVentanaImpresion(html) {
        const win = window.open('', '_blank', 'width=820,height=700,scrollbars=yes');
        win.document.write(html);
        win.document.close();
        win.focus();
        setTimeout(() => { win.print(); }, 400);
    },

    _tplComprobante({ titulo, periodo, emp, filas, neto, fecha, nota }) {
        const hotel = this._nombreSede;
        const filasHtml = filas.map(([lbl, val]) => {
            if (val === '') {
                // Encabezado de sección (INGRESOS / DEDUCCIONES / PROVISIONES)
                return `<tr><td colspan="2" style="padding:10px 14px 4px;font-size:.68rem;font-weight:900;color:#c5a059;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #c5a059;">${lbl}</td></tr>`;
            }
            return `
            <tr>
                <td style="padding:7px 14px;border-bottom:1px solid #eee;font-size:.82rem;">${lbl}</td>
                <td style="padding:7px 14px;border-bottom:1px solid #eee;text-align:right;font-weight:700;font-size:.82rem;">${val}</td>
            </tr>`;
        }).join('');

        const bloque = `
        <div style="border:2px solid #1a365d;border-radius:6px;padding:28px;max-width:680px;margin:0 auto;">
            <div style="text-align:center;border-bottom:3px double #c5a059;padding-bottom:14px;margin-bottom:18px;">
                <div style="font-size:1.4rem;font-weight:900;color:#1a365d;letter-spacing:2px;">${hotel.toUpperCase()}</div>
                <div style="font-size:1rem;font-weight:800;color:#c5a059;margin-top:6px;">${titulo}</div>
                <div style="font-size:.8rem;color:#718096;margin-top:4px;">${periodo} &nbsp;·&nbsp; Emitido: ${fecha}</div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px;font-size:.85rem;">
                <div><span style="font-size:.65rem;font-weight:800;color:#718096;text-transform:uppercase;">Empleado</span><br><strong>${emp.NombreCompleto || '—'}</strong></div>
                <div><span style="font-size:.65rem;font-weight:800;color:#718096;text-transform:uppercase;">Cédula</span><br><strong>${emp.Cedula || '—'}</strong></div>
                <div><span style="font-size:.65rem;font-weight:800;color:#718096;text-transform:uppercase;">Cargo</span><br><strong>${emp.Cargo || '—'}</strong></div>
            </div>
            <table style="width:100%;border-collapse:collapse;margin-bottom:10px;">${filasHtml}
                <tr style="background:#1a365d;color:white;">
                    <td style="padding:11px 14px;font-weight:900;font-size:1rem;">TOTAL A PAGAR</td>
                    <td style="padding:11px 14px;text-align:right;font-weight:900;font-size:1.1rem;">${neto}</td>
                </tr>
            </table>
            ${nota ? `<p style="font-size:.75rem;color:#718096;font-style:italic;margin:10px 0 0;">${nota}</p>` : ''}
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:60px;margin-top:50px;">
                <div style="text-align:center;">
                    <div style="border-top:2px solid #2c3e50;padding-top:8px;font-size:.72rem;font-weight:800;color:#718096;text-transform:uppercase;">Firma del Empleado</div>
                    <div style="font-size:.7rem;color:#718096;margin-top:4px;">${emp.NombreCompleto || ''}</div>
                </div>
                <div style="text-align:center;">
                    <div style="border-top:2px solid #2c3e50;padding-top:8px;font-size:.72rem;font-weight:800;color:#718096;text-transform:uppercase;">Firma Administración</div>
                    <div style="font-size:.7rem;color:#718096;margin-top:4px;">${hotel}</div>
                </div>
            </div>
        </div>`;

        return `<!DOCTYPE html><html><head><meta charset="UTF-8">
        <title>${titulo}</title>
        <style>
            body { font-family: Arial, sans-serif; background:#fff; padding:20px; }
            @media print {
                body { padding:0; }
                .no-print { display:none !important; }
                .page-break { page-break-before: always; }
            }
        </style></head><body>
        ${bloque}
        <div class="page-break" style="border-top:2px dashed #ccc;margin:30px 0;padding-top:6px;text-align:center;font-size:.7rem;color:#aaa;">✂ COPIA PARA EL ARCHIVO — ${hotel}</div>
        ${bloque}
        <div class="no-print" style="text-align:center;margin-top:20px;">
            <button onclick="window.print()" style="padding:10px 24px;background:#1a365d;color:white;border:none;border-radius:8px;font-size:.9rem;cursor:pointer;font-weight:700;">
                🖨️ Imprimir
            </button>
        </div>
        </body></html>`;
    },

    async abrirParametrosLaborales() {
        let actual;
        try {
            const res = await api.get('/personal/parametros-laborales');
            const lista = res.data.parametros || [];
            actual = lista[0] || { Anio: new Date().getFullYear(), SBU: '', AportePersonalIESS: 0.0945, AportePatronalIESS: 0.1115, PorcentajeFondoReserva: 0.0833 };
        } catch (_) {
            actual = { Anio: new Date().getFullYear(), SBU: '', AportePersonalIESS: 0.0945, AportePatronalIESS: 0.1115, PorcentajeFondoReserva: 0.0833 };
        }

        const { value: form } = await Swal.fire({
            title: 'Parámetros Laborales (SBU / IESS)',
            width: 480,
            html: `
                <p style="font-size:0.75rem; color:#718096; text-align:left; margin-bottom:14px;">
                    Ajusta esto cuando el gobierno cambie el Salario Básico Unificado o las tasas del IESS (normalmente cada enero).
                </p>
                <div style="text-align:left; display:flex; flex-direction:column; gap:10px;">
                    <div><label style="font-size:0.75rem; font-weight:800;">Año</label>
                        <input id="sw-anio" type="number" class="swal2-input" style="margin:4px 0;" value="${actual.Anio}"></div>
                    <div><label style="font-size:0.75rem; font-weight:800;">SBU ($)</label>
                        <input id="sw-sbu" type="number" step="0.01" class="swal2-input" style="margin:4px 0;" value="${actual.SBU}"></div>
                    <div><label style="font-size:0.75rem; font-weight:800;">Aporte Personal IESS (ej. 0.0945 = 9.45%)</label>
                        <input id="sw-ap" type="number" step="0.0001" class="swal2-input" style="margin:4px 0;" value="${actual.AportePersonalIESS}"></div>
                    <div><label style="font-size:0.75rem; font-weight:800;">Aporte Patronal IESS (ej. 0.1115 = 11.15%)</label>
                        <input id="sw-at" type="number" step="0.0001" class="swal2-input" style="margin:4px 0;" value="${actual.AportePatronalIESS}"></div>
                    <div><label style="font-size:0.75rem; font-weight:800;">% Fondo de Reserva (ej. 0.0833 = 8.33%)</label>
                        <input id="sw-fr" type="number" step="0.0001" class="swal2-input" style="margin:4px 0;" value="${actual.PorcentajeFondoReserva}"></div>
                </div>
            `,
            showCancelButton: true, confirmButtonText: 'Guardar', confirmButtonColor: '#1a365d',
            preConfirm: () => ({
                anio: parseInt(document.getElementById('sw-anio').value),
                sbu: parseFloat(document.getElementById('sw-sbu').value),
                aportePersonalIESS: parseFloat(document.getElementById('sw-ap').value),
                aportePatronalIESS: parseFloat(document.getElementById('sw-at').value),
                porcentajeFondoReserva: parseFloat(document.getElementById('sw-fr').value)
            })
        });
        if (!form) return;

        try {
            await api.post('/personal/parametros-laborales', form);
            Swal.fire({ icon: 'success', title: 'Parámetros guardados', timer: 1800, showConfirmButton: false });
        } catch (e) {
            Swal.fire({ icon: 'error', title: 'Error', text: e.response?.data?.error || e.message, confirmButtonColor: '#1a365d' });
        }
    },

    destroy() {}
};

module.exports = PersonalModule;
