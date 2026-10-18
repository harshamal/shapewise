import "server-only";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { DocumentModel } from "./model";

/** A4 PDF of a document model. Compact is a narrow receipt-style page. */

const INK = "#1d1b18";
const MUTED = "#6b665e";
const RULE = "#e4e0d8";
const ACCENT = "#c2410c";

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 44, fontSize: 9.5, fontFamily: "Helvetica", color: INK, lineHeight: 1.4 },
  compact: { paddingTop: 24, paddingBottom: 32, paddingHorizontal: 20, fontSize: 8.5 },
  row: { flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  bizName: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  muted: { color: MUTED },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", textAlign: "right", color: ACCENT, textTransform: "uppercase", letterSpacing: 1 },
  number: { fontSize: 11, textAlign: "right", marginTop: 2 },
  status: { marginTop: 6, alignSelf: "flex-end", borderWidth: 1, borderColor: ACCENT, color: ACCENT, paddingHorizontal: 6, paddingVertical: 2, fontSize: 8, textTransform: "uppercase" },
  label: { fontSize: 7.5, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 2 },
  bold: { fontFamily: "Helvetica-Bold" },
  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 4, marginTop: 18 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: RULE, paddingVertical: 5 },
  cell: { paddingRight: 6 },
  right: { textAlign: "right" },
  totals: { marginTop: 10, marginLeft: "auto", width: 220 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  grand: { borderTopWidth: 1, borderTopColor: INK, marginTop: 2, paddingTop: 5, fontFamily: "Helvetica-Bold", fontSize: 11 },
  footer: { position: "absolute", bottom: 24, left: 44, right: 44, fontSize: 7.5, color: MUTED, flexDirection: "row", justifyContent: "space-between" },
});

/** Column widths: the description takes what the numbers leave. */
function widths(doc: DocumentModel): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const c of doc.columns) out[c.key] = c.numeric ? (c.key === "quantity" || c.key === "discount_pct" ? 54 : 76) : c.key === "tax_code" ? 60 : "auto";
  return out;
}

function Doc({ doc }: { doc: DocumentModel }) {
  const compact = doc.layout === "compact";
  const w = widths(doc);
  return (
    <Document title={`${doc.title} ${doc.number}`} author={doc.business.name} creator="Shapewise" producer="Shapewise">
      <Page size={compact ? [226, 800] : "A4"} style={compact ? [s.page, s.compact] : s.page} wrap>
        <View style={compact ? {} : s.between}>
          <View style={{ maxWidth: compact ? undefined : 280 }}>
            <Text style={compact ? [s.bizName, { fontSize: 12 }] : s.bizName}>{doc.business.name}</Text>
            {doc.business.legalName && <Text style={s.muted}>{doc.business.legalName}</Text>}
            {doc.business.lines.map((l) => (
              <Text key={l} style={s.muted}>
                {l}
              </Text>
            ))}
          </View>
          <View style={compact ? { marginTop: 10 } : {}}>
            <Text style={compact ? [s.title, { textAlign: "left", fontSize: 12 }] : s.title}>{doc.title}</Text>
            <Text style={compact ? [s.number, { textAlign: "left" }] : s.number}>{doc.number}</Text>
            {doc.status && <Text style={compact ? [s.status, { alignSelf: "flex-start" }] : s.status}>{doc.status}</Text>}
          </View>
        </View>

        <View style={[compact ? {} : s.between, { marginTop: compact ? 10 : 26 }]}>
          {doc.party ? (
            <View style={{ maxWidth: compact ? undefined : 260 }}>
              <Text style={s.label}>{doc.party.heading}</Text>
              <Text style={s.bold}>{doc.party.name}</Text>
              {doc.party.lines.map((l) => (
                <Text key={l} style={s.muted}>
                  {l}
                </Text>
              ))}
            </View>
          ) : (
            <View />
          )}
          <View style={{ minWidth: compact ? undefined : 180, marginTop: compact ? 8 : 0 }}>
            {doc.meta.map((m) => (
              <View key={m.label} style={[s.between, { paddingVertical: 1 }]}>
                <Text style={[s.muted, { marginRight: 12 }]}>{m.label}</Text>
                <Text style={{ textAlign: "right", maxWidth: 160 }}>{m.value}</Text>
              </View>
            ))}
          </View>
        </View>

        {doc.columns.length > 0 && (
          <View>
            <View style={s.th} fixed>
              {doc.columns.map((c) => (
                <Text key={c.key} style={[s.cell, s.bold, c.numeric ? s.right : {}, w[c.key] === "auto" ? { flex: 1 } : { width: w[c.key] as number }]}>
                  {compact && c.key === "unit_price" ? "Price" : c.label}
                </Text>
              ))}
            </View>
            {doc.rows.map((r, i) => (
              <View key={i} style={s.tr} wrap={false}>
                {doc.columns.map((c) => {
                  const [first, ...rest] = (r[c.key] ?? "").split("\n");
                  return (
                    <View key={c.key} style={[s.cell, w[c.key] === "auto" ? { flex: 1 } : { width: w[c.key] as number }]}>
                      <Text style={c.numeric ? s.right : {}}>{first}</Text>
                      {rest.length > 0 && <Text style={[s.muted, { fontSize: 8 }]}>{rest.join(" ")}</Text>}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        )}

        {doc.amount && (
          <View style={{ marginTop: 24, padding: 14, backgroundColor: "#f6f3ee" }}>
            <Text style={s.label}>{doc.amount.label}</Text>
            <Text style={{ fontSize: 18, fontFamily: "Helvetica-Bold" }}>{doc.amount.value}</Text>
          </View>
        )}

        {doc.totals.length > 0 && (
          <View style={compact ? [s.totals, { width: "100%" }] : s.totals} wrap={false}>
            {doc.totals.map((t) => (
              <View key={t.label} style={t.strong ? [s.totalRow, s.grand] : s.totalRow}>
                <Text style={t.strong ? {} : s.muted}>{t.label}</Text>
                <Text>{t.value}</Text>
              </View>
            ))}
          </View>
        )}

        {doc.notes && (
          <View style={{ marginTop: 22 }} wrap={false}>
            <Text style={s.label}>Notes</Text>
            <Text>{doc.notes}</Text>
          </View>
        )}
        {doc.footer && <Text style={{ marginTop: 22, color: MUTED }}>{doc.footer}</Text>}

        {!compact && (
          <View style={s.footer} fixed>
            <Text>
              {doc.title} {doc.number}
            </Text>
            <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          </View>
        )}
      </Page>
    </Document>
  );
}

export async function renderPdf(doc: DocumentModel): Promise<Buffer> {
  return renderToBuffer(<Doc doc={doc} />);
}

/** A file name people recognise: "INV-2026-00001 Galle Bakehouse.pdf". */
export function pdfName(doc: DocumentModel): string {
  return `${doc.number} ${doc.business.name}`.replace(/[^\w .-]+/g, "").trim().slice(0, 80) + ".pdf";
}
