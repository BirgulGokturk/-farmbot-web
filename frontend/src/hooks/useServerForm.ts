/**
 * Sunucudan beslenen ama kullanıcının da düzenlediği form durumu.
 *
 * Çözdüğü hata: form durumunu `useEffect(..., [device.settings])` ile
 * tazelemek cazip görünüyor ama `device.settings` bir **nesne** ve React Query
 * her yeniden çekişte yeni bir nesne üretiyor. Pencereye geri dönmek, araya
 * giren bir yenileme ya da başka bir karttan yapılan kayıt, kimliği değiştirip
 * efekti tetikliyor ve kullanıcının o an yazdıkları siliniyordu.
 *
 * Çözüm: nesnenin kimliğine değil **içeriğine** bakıyoruz. Sunucudaki değer
 * gerçekten değiştiyse form tazeleniyor; aynı içerik yeni bir nesne olarak
 * geldiğinde kullanıcının düzenlemesi olduğu gibi kalıyor.
 */

import { useEffect, useRef, useState } from "react";

export function useServerForm<T>(serverValue: T): [T, React.Dispatch<React.SetStateAction<T>>, boolean] {
  const [draft, setDraft] = useState<T>(serverValue);
  const lastServer = useRef(JSON.stringify(serverValue));

  useEffect(() => {
    const incoming = JSON.stringify(serverValue);
    if (incoming === lastServer.current) return;
    lastServer.current = incoming;
    setDraft(serverValue);
  }, [serverValue]);

  const dirty = JSON.stringify(draft) !== lastServer.current;
  return [draft, setDraft, dirty];
}
