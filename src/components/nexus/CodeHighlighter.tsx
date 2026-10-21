'use client'

// ─── NEXUS — Coloration syntaxique (chargée à la demande) ─────────────────────
// Version « légère » de Prism : seuls les langages que NEXUS écrit ou que le
// Studio Code propose sont embarqués (au lieu des ~300 grammaires de la version
// complète, plus de 600 Ko de JavaScript dans le premier téléchargement du
// chat). Ce module n'est chargé qu'à l'apparition du premier bloc de code ;
// un langage non listé s'affiche simplement sans coloration.

import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light'
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c'
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp'
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff'
import docker from 'react-syntax-highlighter/dist/esm/languages/prism/docker'
import glsl from 'react-syntax-highlighter/dist/esm/languages/prism/glsl'
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go'
import graphql from 'react-syntax-highlighter/dist/esm/languages/prism/graphql'
import ini from 'react-syntax-highlighter/dist/esm/languages/prism/ini'
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx'
import kotlin from 'react-syntax-highlighter/dist/esm/languages/prism/kotlin'
import lua from 'react-syntax-highlighter/dist/esm/languages/prism/lua'
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown'
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import php from 'react-syntax-highlighter/dist/esm/languages/prism/php'
import powershell from 'react-syntax-highlighter/dist/esm/languages/prism/powershell'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import ruby from 'react-syntax-highlighter/dist/esm/languages/prism/ruby'
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust'
import scss from 'react-syntax-highlighter/dist/esm/languages/prism/scss'
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift'
import toml from 'react-syntax-highlighter/dist/esm/languages/prism/toml'
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'

const LANGUAGES: Record<string, unknown> = {
  bash, c, cpp, csharp, css, diff, docker, glsl, go, graphql, ini, java, javascript, json, jsx, kotlin, lua,
  markdown, markup, php, powershell, python, ruby, rust, scss, sql, swift, toml, tsx, typescript, yaml,
}
for (const [name, grammar] of Object.entries(LANGUAGES)) SyntaxHighlighter.registerLanguage(name, grammar)
// Alias courants dans les réponses (en plus de ceux fournis par chaque grammaire :
// js, ts, py, html, xml, svg, yml, md, rb, cs, shell…)
SyntaxHighlighter.alias({
  bash: ['sh', 'zsh', 'console'],
  lua: ['luau'],
  cpp: ['c++', 'hpp', 'cc'],
  javascript: ['node', 'mjs', 'cjs'],
  docker: ['dockerfile'],
  powershell: ['ps1'],
  kotlin: ['kt'],
  rust: ['rs'],
  go: ['golang'],
})

export default function CodeHighlighter({ language, value }: { language: string; value: string }) {
  return (
    <SyntaxHighlighter
      language={language || 'text'}
      style={oneDark}
      customStyle={{ margin: 0, padding: '1rem', background: 'transparent', fontSize: '0.8rem' }}
      wrapLongLines
    >
      {value}
    </SyntaxHighlighter>
  )
}
