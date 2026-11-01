// Unidades de medida del inventario (Fase 2). El stock se guarda en la unidad base
// (g, ml o und); aquí solo se formatea y se convierte para mostrar / capturar.
const Unidades = {
    // Unidades que se pueden escribir para cada unidad base, con su factor a la base.
    COMPATIBLES: {
        G:   [['G', 'g', 1], ['KG', 'kg', 1000], ['LB', 'lb', 453.592], ['OZ', 'oz', 28.3495]],
        ML:  [['ML', 'ml', 1], ['L', 'l', 1000], ['GAL', 'gal', 3785.41]],
        UND: [['UND', 'und', 1], ['DOC', 'docena', 12]],
    },
    NOMBRE_BASE: { G: 'gramos', ML: 'mililitros', UND: 'unidades' },

    // 1500 g → "1,5 kg"; 750 ml → "750 ml"; 3 und → "3 und"
    fmt(cant, base) {
        const n = Number(cant) || 0;
        const f = (v, d) => v.toLocaleString('es-EC', { maximumFractionDigits: d });
        switch ((base || 'UND').toUpperCase()) {
            case 'G':  return Math.abs(n) >= 1000 ? `${f(n / 1000, 3)} kg` : `${f(n, 1)} g`;
            case 'ML': return Math.abs(n) >= 1000 ? `${f(n / 1000, 3)} l` : `${f(n, 1)} ml`;
            default:   return `${f(n, 3)} und`;
        }
    },

    // Costo por unidad base expresado en una unidad cómoda: $/kg, $/l o $/und.
    fmtCosto(costoBase, base) {
        const c = Number(costoBase) || 0;
        switch ((base || 'UND').toUpperCase()) {
            case 'G':  return `$${(c * 1000).toFixed(2)}/kg`;
            case 'ML': return `$${(c * 1000).toFixed(2)}/l`;
            default:   return `$${c.toFixed(c < 1 ? 4 : 2)}/und`;
        }
    },

    opciones(base, seleccionada) {
        return (this.COMPATIBLES[(base || 'UND').toUpperCase()] || this.COMPATIBLES.UND)
            .map(([cod, txt]) => `<option value="${cod}" ${cod === seleccionada ? 'selected' : ''}>${txt}</option>`).join('');
    },

    factor(base, unidad) {
        const u = (this.COMPATIBLES[(base || 'UND').toUpperCase()] || []).find(x => x[0] === unidad);
        return u ? u[2] : 1;
    },
};

if (typeof window !== 'undefined') window.Unidades = Unidades;
if (typeof module !== 'undefined') module.exports = Unidades;
