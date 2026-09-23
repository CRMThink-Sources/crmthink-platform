package br.com.crmthink.platform;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;

/**
 * Teste sem framework (roda com `java`), com o vetor gerado pela implementação da
 * plataforma (Node): secret `whsec_test`, t=1788264000, corpo {"eventId":"e1"}.
 * Em projeto Maven/Gradle, converta para JUnit.
 */
public final class PlatformSignatureTest {

    private static final String EXPECTED =
            "d09de7f08fc51b54836e0649ff5b4ec82d69da1a04fa256a9fe44065798cf35b";
    private static final byte[] BODY = "{\"eventId\":\"e1\"}".getBytes(StandardCharsets.UTF_8);
    private static final Instant NOW = Instant.ofEpochSecond(1788264000L);

    public static void main(String[] args) {
        String header = "t=1788264000,v1=" + EXPECTED;
        check(PlatformSignature.verify(header, BODY, List.of("whsec_test"), NOW, 300), PlatformSignature.Result.OK, "assinatura válida");
        check(PlatformSignature.verify(header, BODY, List.of("outro", "whsec_test"), NOW, 300), PlatformSignature.Result.OK, "rotação: qualquer segredo vigente");
        check(PlatformSignature.verify(header, BODY, List.of("errado"), NOW, 300), PlatformSignature.Result.MISMATCH, "segredo errado");
        check(PlatformSignature.verify(header, "{}".getBytes(StandardCharsets.UTF_8), List.of("whsec_test"), NOW, 300), PlatformSignature.Result.MISMATCH, "corpo alterado");
        check(PlatformSignature.verify(header, BODY, List.of("whsec_test"), NOW.plusSeconds(301), 300), PlatformSignature.Result.EXPIRED, "mais de 5 minutos");
        check(PlatformSignature.verify("lixo", BODY, List.of("whsec_test"), NOW, 300), PlatformSignature.Result.MALFORMED, "header malformado");
        check(PlatformSignature.verify("t=1788264000,v1=zz,v1=" + EXPECTED, BODY, List.of("whsec_test"), NOW, 300), PlatformSignature.Result.OK, "várias assinaturas");
        System.out.println("PlatformSignatureTest: OK");
    }

    private static void check(PlatformSignature.Result actual, PlatformSignature.Result expected, String name) {
        if (actual != expected) {
            throw new AssertionError(name + ": esperado " + expected + ", obtido " + actual);
        }
    }
}
