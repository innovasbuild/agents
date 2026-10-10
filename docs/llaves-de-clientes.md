# Llaves de clientes: cómo entran a la plataforma

Las llaves de API de un cliente (ColdIQ, Apollo, Google Places) son del cliente. Viven en Vercel Connect, nunca en nuestra base, en el código, en un mail ni en una pantalla de la plataforma. La plataforma guarda solo el **identificador** del conector, que no es secreto.

## Quién hace qué

| Paso | Quién |
|---|---|
| Crea la llave en el proveedor | El cliente |
| Se la pasa a INNOV.AS | El cliente, por un canal seguro |
| Crea el conector en Vercel y lo adjunta al proyecto | INNOV.AS |
| Asocia el identificador a la empresa en la consola | INNOV.AS |
| Rota o da de baja | INNOV.AS, a pedido del cliente |

## Canal seguro

Nunca por mail, chat, ticket ni documento compartido. Opciones aceptadas: un gestor de secretos compartido con enlace de un solo uso, o la llave dictada en una llamada y tipeada directo en el comando de abajo. Si una llave llegó por un canal que no es seguro, se da por comprometida: pedirle al cliente que la rote antes de cargarla.

## Alta

Desde la carpeta del proyecto (`vercel link` ya hecho):

```bash
vercel connect create <servicio> --name <slug>-<proveedor>
vercel connect attach <uid> --yes
```

El nombre lleva el slug de la empresa para que `vercel connect list` lo muestre sin ambigüedad. El comando pide la llave en el momento; no se guarda en ningún archivo. Después:

1. Si la llave quedó en el portapapeles, en el historial de la terminal o en un archivo temporal, borrarla.
2. En `/plataforma/<slug>`, sección Conectores, elegir el proveedor y pegar el `uid`. La consola le pregunta a Vercel si existe y está adjunto, y recién ahí lo guarda. Si Vercel no lo conoce, no se guarda nada.
3. Un `uid` solo puede estar asociado a una empresa. Si la consola dice que ya está asociado a otra, no es un error de tipeo: es una llave de otro cliente.

## Rotación

1. El cliente crea la llave nueva y la pasa por el canal seguro.
2. `vercel connect create` con un nombre nuevo (`<slug>-<proveedor>-2`) y `attach`.
3. En la consola, asociar el `uid` nuevo al mismo proveedor: reemplaza al viejo y libera su identificador.
4. En Vercel, borrar el conector viejo. La consola no lo hace.

## Baja

1. En la consola, Quitar. Queda el evento `connection.removed` con quién lo hizo.
2. En Vercel, borrar el conector.
3. Avisarle al cliente que revoque la llave en el proveedor.

## Lo que no hace la plataforma

- No pide ni muestra llaves. Si una pantalla lo hiciera, es un bug grave.
- No verifica que la llave funcione contra el proveedor: eso se ve en la primera corrida del agente.
- No crea conectores desde la web. Cuando Vercel habilite la instalación por una página del cliente, este documento cambia.
