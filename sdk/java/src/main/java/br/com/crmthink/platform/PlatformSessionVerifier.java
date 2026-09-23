package br.com.crmthink.platform;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.JWKSourceBuilder;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.proc.ConfigurableJWTProcessor;
import com.nimbusds.jwt.proc.DefaultJWTClaimsVerifier;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import java.net.MalformedURLException;
import java.net.URI;
import java.util.List;
import java.util.Set;

/**
 * Valida o JWT RS256 da sessão do iframe pelo JWKS da plataforma: assinatura, {@code iss},
 * {@code aud} (= appCode do app) e {@code exp}. Requer {@code com.nimbusds:nimbus-jose-jwt}
 * (9.37+).
 *
 * <p>O {@link JWKSourceBuilder} guarda o JWKS em cache e o recarrega quando chega um
 * {@code kid} desconhecido — é o que cobre a rotação de chaves da plataforma.
 *
 * <p>Uso (Spring Security: registre como {@code JwtDecoder} ou chame num filtro):
 * <pre>
 * var verifier = new PlatformSessionVerifier("https://platform.crmthink.com.br", "crmthink.gptmaker");
 * PlatformSessionVerifier.Session s = verifier.verify(bearerToken);
 * if (!s.isAdmin()) { ... }
 * </pre>
 */
public final class PlatformSessionVerifier {

    public record Session(
            String userId,
            long installationId,
            String memberId,
            String domain,
            boolean isAdmin,
            String name,
            List<Long> departmentIds) {}

    private final ConfigurableJWTProcessor<SecurityContext> processor;

    public PlatformSessionVerifier(String platformUrl, String appCode) throws MalformedURLException {
        this(platformUrl, appCode, platformUrl.replaceAll("/+$", ""));
    }

    public PlatformSessionVerifier(String platformUrl, String appCode, String issuer) throws MalformedURLException {
        String base = platformUrl.replaceAll("/+$", "");
        JWKSource<SecurityContext> jwks = JWKSourceBuilder
                .create(URI.create(base + "/.well-known/jwks.json").toURL())
                .retrying(true)
                .build();
        processor = new DefaultJWTProcessor<>();
        processor.setJWSKeySelector(new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, jwks));
        processor.setJWTClaimsSetVerifier(new DefaultJWTClaimsVerifier<>(
                appCode,
                new JWTClaimsSet.Builder().issuer(issuer).build(),
                Set.of("sub", "exp", "installationId", "memberId", "domain", "isAdmin")));
    }

    /** Lança exceção se o token for inválido, expirado ou de outro app. */
    public Session verify(String token) throws Exception {
        JWTClaimsSet claims = processor.process(token, null);
        List<Object> departments = claims.getListClaim("departmentIds");
        return new Session(
                claims.getSubject(),
                claims.getLongClaim("installationId"),
                claims.getStringClaim("memberId"),
                claims.getStringClaim("domain"),
                Boolean.TRUE.equals(claims.getBooleanClaim("isAdmin")),
                claims.getStringClaim("name"),
                departments == null ? List.of() : departments.stream().map(d -> ((Number) d).longValue()).toList());
    }
}
