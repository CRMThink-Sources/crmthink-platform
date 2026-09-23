package br.com.crmthink.platform;

import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Verificação do header {@code X-Platform-Signature} dos webhooks da plataforma
 * (eventos e chamada do instalador). Só JDK (17+), sem dependências.
 *
 * <pre>X-Platform-Signature: t=&lt;unix&gt;,v1=&lt;hex(hmac-sha256(secret, t + "." + body))&gt;</pre>
 *
 * Use o corpo <b>cru</b> da requisição (os bytes recebidos), nunca o JSON re-serializado.
 * Durante a rotação do segredo o header traz um {@code v1=} por segredo; passe os seus
 * segredos vigentes.
 */
public final class PlatformSignature {

    public static final String HEADER = "X-Platform-Signature";
    public static final long DEFAULT_TOLERANCE_SECONDS = 300;

    public enum Result { OK, MALFORMED, EXPIRED, MISMATCH }

    private PlatformSignature() {}

    public static Result verify(String header, byte[] rawBody, List<String> secrets) {
        return verify(header, rawBody, secrets, Instant.now(), DEFAULT_TOLERANCE_SECONDS);
    }

    public static Result verify(
            String header, byte[] rawBody, List<String> secrets, Instant now, long toleranceSeconds) {
        if (header == null || header.isBlank()) return Result.MALFORMED;
        Long timestamp = null;
        List<String> signatures = new ArrayList<>();
        for (String part : header.split(",")) {
            String p = part.trim();
            if (p.startsWith("t=")) {
                try {
                    timestamp = Long.parseLong(p.substring(2));
                } catch (NumberFormatException e) {
                    return Result.MALFORMED;
                }
            } else if (p.startsWith("v1=")) {
                signatures.add(p.substring(3));
            }
        }
        if (timestamp == null || signatures.isEmpty()) return Result.MALFORMED;
        if (Math.abs(now.getEpochSecond() - timestamp) > toleranceSeconds) return Result.EXPIRED;

        byte[] prefix = (timestamp + ".").getBytes(StandardCharsets.UTF_8);
        byte[] signed = new byte[prefix.length + rawBody.length];
        System.arraycopy(prefix, 0, signed, 0, prefix.length);
        System.arraycopy(rawBody, 0, signed, prefix.length, rawBody.length);

        for (String secret : secrets) {
            byte[] expected = HexFormat.of().formatHex(hmacSha256(secret, signed)).getBytes(StandardCharsets.US_ASCII);
            for (String signature : signatures) {
                // Tempo constante: MessageDigest.isEqual não curto-circuita.
                if (MessageDigest.isEqual(expected, signature.getBytes(StandardCharsets.US_ASCII))) {
                    return Result.OK;
                }
            }
        }
        return Result.MISMATCH;
    }

    static byte[] hmacSha256(String secret, byte[] data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return mac.doFinal(data);
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            throw new IllegalStateException("HmacSHA256 indisponível", e);
        }
    }
}
