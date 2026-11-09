import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Next 16: "proxy" substitui o antigo "middleware".
// Aqui só renovamos a sessão e redirecionamos. A autorização de verdade fica no
// layout protegido (perfil ativo) e, principalmente, no RLS do banco.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    },
  );

  // Valida o JWT (não confia só no cookie) e renova a sessão se preciso.
  const { data } = await supabase.auth.getClaims();
  const logado = Boolean(data?.claims?.sub);

  const { pathname, search } = request.nextUrl;
  const naTelaDeLogin = pathname === "/painel/login";

  const redirecionar = (caminho: string, query = "") => {
    const url = request.nextUrl.clone();
    url.pathname = caminho;
    url.search = query;
    const r = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };

  if (!logado && !naTelaDeLogin) {
    return redirecionar("/painel/login", `?next=${encodeURIComponent(pathname + search)}`);
  }
  if (logado && (naTelaDeLogin || pathname === "/painel" || pathname === "/painel/")) {
    return redirecionar("/painel/cmv");
  }
  return response;
}

export const config = {
  matcher: ["/painel", "/painel/:path*"],
};
