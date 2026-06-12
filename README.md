# Baloncesto Galego

Aplicación web estática para consultar categorías, equipos, xogadores e partidos
do baloncesto galego.

## Aviso

Este proxecto é só unha interface web para consultar datos publicados
abertamente en Internet polos servizos orixinais. Non almacena nin vende datos,
non é unha fonte oficial e non garante que a información estea completa,
actualizada ou libre de erros.

O uso desta web e do seu código é responsabilidade de cada persoa usuaria. As
persoas autoras e colaboradoras non se fan responsables do uso que se faga da
aplicación, do código, dos datos consultados nin das consecuencias derivadas
dese uso.

## Desenvolvemento Local

Serve o cartafol con calquera servidor estático:

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

Logo abre:

```text
http://127.0.0.1:8080/
```

## GitHub Pages

O repositorio inclúe un workflow de GitHub Actions en
`.github/workflows/pages.yml`. En cada push a `main`, publícanse só os ficheiros
estáticos da web:

- `index.html`
- `app.js`
- `styles.css`
- `robots.txt`
- `.nojekyll`

Activa GitHub Pages na configuración do repositorio e escolle GitHub Actions
como fonte.

## Privacidade e Indexación

A web inclúe `robots.txt` e metadatos `noindex` para crawlers que respectan
estes estándares. Isto non substitúe un control de acceso real se a web debe ser
privada.

## Licenza

Este proxecto publícase baixo a licenza MIT. Consulta [LICENSE](LICENSE).
