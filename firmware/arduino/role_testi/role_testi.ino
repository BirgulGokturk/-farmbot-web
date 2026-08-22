/*
 * Röle testi — tek pini yavaşça açıp kapatır.
 *
 * Neden ayrı bir eskiz: asıl eskiz sensör okuyor, seri yayın yapıyor ve
 * otonom kararlar veriyor. Röle çalışmadığında sebebin bunlardan biri olup
 * olmadığını ayırt etmek zor. Burada başka hiçbir şey yok — yalnızca pin
 * açılıyor ve kapanıyor.
 *
 * Beşer saniyelik evreler: tıklamayı duymak, ışığa bakmak ve gerekirse
 * multimetreyle ölçmek için yeterli süre.
 *
 * DİKKAT: Bu eskizi yüklemek asıl eskizin yerine geçer. Test bittikten sonra
 * `farmbot_sensors` eskizini yeniden yüklemeyi unutmayın, yoksa sensörler
 * ve pompalar panelden çalışmaz.
 */

// Denenecek pin. Röleyi başka bir pine taşırsanız burayı değiştirin.
#define ROLE_PIN 12

void setup() {
  Serial.begin(9600);

  // Önce KAPALI konuma al, sonra çıkışa çevir: pinMode'dan sonra
  // digitalWrite yapmak, aradaki kısa anda rölenin çekmesine yol açabiliyor.
  digitalWrite(ROLE_PIN, LOW);
  pinMode(ROLE_PIN, OUTPUT);
  digitalWrite(ROLE_PIN, LOW);

  Serial.println();
  Serial.print("Role testi — pin D");
  Serial.println(ROLE_PIN);
  Serial.println("Her evre 5 saniye. Tiklama sesini ve yesil isigi izleyin.");
  Serial.println("----------------------------------------");
  delay(1000);
}

void loop() {
  Serial.println("D12 = HIGH (5V)  -> role CEKMELI, yesil isik YANMALI");
  digitalWrite(ROLE_PIN, HIGH);
  delay(5000);

  Serial.println("D12 = LOW  (0V)  -> role BIRAKMALI, yesil isik SONMELI");
  digitalWrite(ROLE_PIN, LOW);
  delay(5000);

  Serial.println("----------------------------------------");
}
