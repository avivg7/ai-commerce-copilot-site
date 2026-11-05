import type { EaDict } from "./en";
import type { DeepPartial } from "../merge";

/**
 * Early Access campaign copy, Spanish (neutral international Spanish, formal "usted"). Machine draft of the same standing as the rest of es.ts: not reviewed by native speakers (see common.draft.translation).
 * Dates are written as Spanish writes them and are legal facts, checked by scripts/lib/early-access-truth.mjs: 31 de diciembre de 2026 (last free day), 1 de enero de 2027 (access ends).
 * Terms reused from the existing pack: tienda, escaparate, proceso de pago, Datos y confianza, conservación, plan, pedidos, correo.
 * Banned here as in the English file: trial, subscription, automatic renewal wording, urgency, discount and percentage wording.
 */
export const eaEs: DeepPartial<EaDict> = {
  bar: {
    label: "Anuncio de Acceso anticipado",
    live: "Acceso anticipado: AICC es gratis hasta el 31 de diciembre de 2026.",
    announce: "El Acceso anticipado llega pronto: AICC será gratis hasta el 31 de diciembre de 2026.",
    link: "Cómo funciona",
  },
  after: {
    title: "El Acceso anticipado ha terminado.",
    body: "El Acceso anticipado terminó el 1 de enero de 2027. Para seguir usando AICC, usted elige un plan. No se cobra nada automáticamente.",
    cta: "Ver planes",
  },
  hero: {
    ctaOpen: "Obtener Acceso anticipado gratis",
    ctaAnnounce: "Cómo funciona el Acceso anticipado",
    note: "No hace falta tarjeta de crédito. El acceso termina el 1 de enero de 2027 y no se cobra nada automáticamente.",
  },
  plan: {
    free: "Gratis hasta el 31 de diciembre de 2026",
    regular: "Precio regular",
    regularPer: "al año",
    regularNote: "no se cobra durante el Acceso anticipado",
    ends: "El acceso termina el 1 de enero de 2027. Un plan de pago empieza solo si usted decide comprarlo.",
    ctaOpen: "Obtener Acceso anticipado gratis",
    ctaAnnounce: "El Acceso anticipado abre pronto",
  },
  section: {
    title: "Acceso anticipado: gratis hasta finales de 2026",
    lead: "Use el producto completo en su tienda WooCommerce sin coste hasta el 31 de diciembre de 2026. El 1 de enero de 2027 el acceso termina. Si quiere continuar, elige un plan de pago. No se cobra nada automáticamente.",
    homeLead: "Durante el Acceso anticipado, todos los planes son gratis hasta el 31 de diciembre de 2026. El acceso termina el 1 de enero de 2027, y un plan de pago empieza solo si usted decide comprarlo.",
    link: "Cómo funciona el Acceso anticipado",
    stepsLabel: "Cómo funciona el Acceso anticipado",
    steps: {
      request: { title: "Solicite el acceso", body: "Pida el Acceso anticipado para su tienda WooCommerce. No hace falta tarjeta de crédito." },
      use: { title: "Use todo", body: "Conecte su tienda y use el producto completo hasta el 31 de diciembre de 2026." },
      decide: { title: "Decida al final", body: "El 1 de enero de 2027 el acceso termina y su tienda sigue vendiendo como siempre. Para continuar, elige un plan; si no lo hace, no se cobra nada." },
    },
    whoTitle: "Para quién es",
    who: {
      a: "Tiendas WooCommerce que pueden conectarse a AICC (WordPress 6.0, WooCommerce 7.0 y PHP 7.4 o posterior).",
      b: "Todas las tiendas aprobadas terminan el mismo día, el 1 de enero de 2027, sea cual sea el día en que empezaron.",
      c: "Un Acceso anticipado por tienda y por cuenta. El número de tiendas depende del plan que solicite: Solo 1 tienda, Studio hasta 3, Agency hasta 10.",
      d: "Aprobamos cada solicitud, y el Acceso anticipado puede cerrarse a nuevas solicitudes en cualquier momento.",
    },
    endTitle: "Qué ocurre el 1 de enero de 2027",
    end: {
      a: "AICC deja de mostrarse en el escaparate de su tienda. Su tienda, sus pedidos y su proceso de pago siguen como siempre.",
      b: "Sus datos de AICC se conservan según las reglas de conservación de la página Datos y confianza, y no se eliminan ese día.",
      c: "Para continuar, usted mismo elige y compra un plan. No hay conversión automática ni cobro automático.",
    },
    terms: "El Acceso anticipado es el mismo producto que los planes de pago. El soporte es por correo electrónico en {contactEmail}. Se aplican las páginas de términos, privacidad y reembolso; la fecha de fin, la ausencia de cobros automáticos y el tratamiento de los datos descritos arriba forman parte de la oferta.",
    faqTitle: "Preguntas sobre el Acceso anticipado",
    faq: {
      free: { q: "¿El Acceso anticipado es realmente gratis?", a: "Sí, hasta el 31 de diciembre de 2026. No pedimos datos de pago y no se cobra nada." },
      end: { q: "¿Qué ocurre el 1 de enero de 2027?", a: "El acceso termina para todas las tiendas del Acceso anticipado al mismo tiempo. AICC deja de mostrarse en el escaparate de su tienda y esta sigue funcionando como siempre. Para continuar, usted elige y compra un plan." },
      auto: { q: "¿Se me cobrará automáticamente?", a: "No. No hay tarjeta guardada, nada se renueva por sí solo y no hay cambio automático a un plan de pago." },
      continue: { q: "¿Cómo continúo después del Acceso anticipado?", a: "Elige un plan y lo compra cuando las compras estén abiertas. Le explicamos los pasos antes de comprar, incluido lo que ocurre con su tienda conectada." },
    },
  },
};
