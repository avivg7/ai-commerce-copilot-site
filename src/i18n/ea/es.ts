import type { EaDict } from "./en";
import type { DeepPartial } from "../merge";

/**
 * Early Access campaign copy, Spanish (neutral international Spanish, formal "usted"). Machine draft of the same standing as the rest of es.ts: not reviewed by native speakers (see common.draft.translation).
 * Dates are written as Spanish writes them and are legal facts, checked by scripts/lib/early-access-truth.mjs: 31 de diciembre de 2026 (last free day), 1 de enero de 2027 (access ends).
 * The time zone is always stated as "hora de Israel" (Israel time) and the UTC instant as "22:00 UTC".
 * Terms reused from the existing pack: tienda, escaparate, proceso de pago, Datos y confianza, conservación, plan, pedidos, plugin, garantía de devolución del dinero de 14 días.
 * Banned here as in the English file: trial, subscription, automatic renewal wording, urgency, discount and percentage wording.
 */
export const eaEs: DeepPartial<EaDict> = {
  bar: {
    label: "Anuncio de Acceso anticipado",
    live: "Acceso anticipado: AICC es gratis para tiendas aprobadas hasta el 31 de diciembre de 2026, hora de Israel.",
    announce: "El Acceso anticipado llega pronto: AICC será gratis para tiendas aprobadas hasta el 31 de diciembre de 2026, hora de Israel.",
    link: "Cómo funciona",
  },
  after: {
    title: "El Acceso anticipado ha terminado.",
    body: "El Acceso anticipado terminó el 1 de enero de 2027 a las 00:00, hora de Israel. Para seguir usando AICC, usted elige un plan. No se cobra nada automáticamente.",
    cta: "Ver planes",
  },
  hero: {
    ctaOpen: "Solicitar Acceso anticipado gratis",
    ctaAnnounce: "Cómo funciona el Acceso anticipado",
    note: "No hace falta tarjeta de crédito. El acceso termina el 1 de enero de 2027 a las 00:00, hora de Israel, y no se cobra nada automáticamente.",
  },
  header: { cta: "Solicitar Acceso anticipado" },
  plan: {
    free: "Gratis hasta el 31 de diciembre de 2026",
    regular: "Precio regular, no se cobra durante el Acceso anticipado:",
    regularPer: "al año",
    noCard: "No hace falta tarjeta de crédito",
    term: "Duración del Acceso anticipado: hasta el 31 de diciembre de 2026, hora de Israel",
    ends: "El acceso termina el 1 de enero de 2027 a las 00:00, hora de Israel (22:00 UTC del 31 de diciembre). Un plan de pago empieza solo si usted decide comprarlo.",
    ctaOpen: "Solicitar Acceso anticipado gratis",
    ctaAnnounce: "El Acceso anticipado abre pronto",
  },
  section: {
    title: "Acceso anticipado: gratis hasta finales de 2026",
    lead: "Use el producto completo en su tienda WooCommerce sin coste hasta el 31 de diciembre de 2026. El acceso termina el 1 de enero de 2027 a las 00:00, hora de Israel (22:00 UTC del 31 de diciembre de 2026). Si quiere continuar, elige un plan de pago. No se cobra nada automáticamente.",
    homeLead: "Durante el Acceso anticipado, todos los planes son gratis para tiendas aprobadas hasta el 31 de diciembre de 2026, hora de Israel. El acceso termina el 1 de enero de 2027, y un plan de pago empieza solo si usted decide comprarlo.",
    link: "Cómo funciona el Acceso anticipado",
    stepsLabel: "Cómo funciona el Acceso anticipado",
    steps: {
      request: { title: "Solicite el acceso", body: "Pida el Acceso anticipado para su tienda WooCommerce. No hace falta tarjeta de crédito. Revisamos cada solicitud." },
      use: { title: "Use todo", body: "Conecte su tienda y use el producto completo hasta el 31 de diciembre de 2026." },
      decide: { title: "Decida al final", body: "El 1 de enero de 2027 a las 00:00, hora de Israel, el acceso termina y su tienda sigue vendiendo como siempre. Para continuar, compra el mismo plan que usó; si no lo hace, no se cobra nada." },
    },
    whoTitle: "Para quién es",
    who: {
      a: "Tiendas WooCommerce que pueden conectarse a AICC (WordPress 6.0, WooCommerce 7.0 y PHP 7.4 o posterior).",
      b: "Todas las tiendas aprobadas terminan en el mismo momento, a las 00:00 del 1 de enero de 2027, hora de Israel, sea cual sea el día en que empezaron.",
      c: "Un Acceso anticipado por tienda y por cuenta. El número de tiendas depende del plan que solicite: Solo 1 tienda, Studio hasta 3, Agency hasta 10. Pida el plan que querría conservar: continuar es más sencillo con el mismo plan.",
      d: "Revisamos cada solicitud y no todas se aprobarán. El Acceso anticipado puede cerrarse a nuevas solicitudes en cualquier momento.",
    },
    endTitle: "Qué ocurre el 1 de enero de 2027",
    end: {
      a: "AICC deja de mostrarse en el escaparate de su tienda. Su tienda, sus pedidos y su proceso de pago siguen como siempre.",
      b: "Sus datos de AICC se conservan según las reglas de conservación de la página Datos y confianza, y no se eliminan ese día.",
      c: "Para continuar, compra el mismo plan que usó durante el Acceso anticipado, y su tienda conectada recibe la nueva fecha de fin. Un plan distinto es una compra aparte, y le explicamos los pasos antes de comprar. No hay conversión automática ni cobro automático.",
    },
    terms: "El Acceso anticipado es el mismo producto que los planes de pago. La fecha de fin, la ausencia de cobros automáticos y el tratamiento de los datos descritos en esta página son los términos de esta oferta. ¿Preguntas? Escriba a {contactEmail}.",
    faqTitle: "Preguntas sobre el Acceso anticipado",
    faq: {
      free: { q: "¿El Acceso anticipado es realmente gratis?", a: "Sí, para tiendas aprobadas hasta el 31 de diciembre de 2026. No pedimos datos de pago y no se cobra nada." },
      end: { q: "¿Qué ocurre el 1 de enero de 2027?", a: "El acceso termina para todas las tiendas del Acceso anticipado en el mismo momento, a las 00:00 hora de Israel. AICC deja de mostrarse en el escaparate de su tienda y esta sigue funcionando como siempre. Para continuar, usted compra un plan." },
      auto: { q: "¿Se me cobrará automáticamente?", a: "No. No hay tarjeta guardada, nada se renueva por sí solo y no hay cambio automático a un plan de pago." },
      continue: { q: "¿Cómo continúo después del Acceso anticipado?", a: "Compra el mismo plan que usó, cuando las compras estén abiertas. Su tienda conectada recibe la nueva fecha de fin. Para un plan distinto, le explicamos los pasos antes de comprar." },
      guarantee: { q: "¿La garantía de devolución del dinero se aplica al Acceso anticipado?", a: "No se cobra ningún pago, así que no hay nada que reembolsar. La garantía de 14 días de la política de reembolso se refiere a las compras de pago. El plugin puede mostrar en sus primeros días un mensaje de garantía de 14 días; se refiere a las compras de pago." },
      plugin: { q: "¿Qué verá en el plugin cuando termine el Acceso anticipado?", a: "A las 00:00 del 1 de enero de 2027 (hora de Israel) el plugin indica que su plan ha caducado y AICC deja de mostrarse en el escaparate de su tienda. Su tienda sigue vendiendo como siempre. El plugin no avisa de antemano, así que anote la fecha; la página de su cuenta también la muestra." },
    },
  },
};
