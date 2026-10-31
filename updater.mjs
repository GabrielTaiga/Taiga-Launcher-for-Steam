// Atualização automática pelas Releases do GitHub: confere a versão mais nova, baixa o .zip do programa e, ao
// aplicar, um script do PowerShell espera o programa fechar, copia os arquivos novos por cima (sem tocar em
// chaves.json nem na pasta de dados) e abre o programa de novo.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const parseVersion = v => String(v || '').replace(/^v/i, '').split(/[.-]/).slice(0, 3).map(n => Number.parseInt(n, 10) || 0);
export const newer = (a, b) => { const x = parseVersion(a), y = parseVersion(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

// Vários repositórios (o atual primeiro, o nome antigo de reserva): usa a versão mais nova encontrada.
export async function latestReleaseAny(repos, opts = {}) {
 let best = null, lastError = null;
 for (const repo of [].concat(repos || []).filter(Boolean)) { try { const r = await latestRelease(repo, opts); if (r && (!best || newer(r.version, best.version))) best = r; } catch (e) { lastError = e; } }
 if (!best && lastError) throw lastError;
 return best;
}
export async function latestRelease(repo, {fetchImpl = (...a) => fetch(...a)} = {}) {
 if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo || ''))) return null;
 const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {headers: {Accept: 'application/vnd.github+json', 'User-Agent': 'TaigaLauncher'}, signal: AbortSignal.timeout(15000)});
 if (!res.ok) throw Error('GitHub respondeu HTTP ' + res.status + '.');
 const r = await res.json();
 const asset = (r.assets || []).find(a => /\.zip$/i.test(a.name) && /taiga/i.test(a.name) && !/atualiza|update|patch/i.test(a.name)) || (r.assets || []).find(a => /\.zip$/i.test(a.name));
 if (!r.tag_name || !asset) return null;
 return {version: String(r.tag_name).replace(/^v/i, ''), notes: String(r.body || '').slice(0, 4000), url: asset.browser_download_url, size: Number(asset.size) || 0, sha256: /^sha256:[0-9a-f]{64}$/i.test(String(asset.digest || '')) ? String(asset.digest).slice(7).toLowerCase() : '', name: asset.name, page: r.html_url || ''};
}

export async function downloadRelease(rel, dir, {fetchImpl = (...a) => fetch(...a), onProgress = () => {}} = {}) {
 if (!/^https:\/\/(github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com)\//.test(rel.url)) throw Error('Endereço de atualização não permitido.');
 fs.mkdirSync(dir, {recursive: true});
 const file = path.join(dir, 'taiga-launcher-' + rel.version.replace(/[^\d.]/g, '') + '.zip'), part = file + '.part';
 if (fs.existsSync(file) && (!rel.size || fs.statSync(file).size === rel.size)) return file;
 const res = await fetchImpl(rel.url, {headers: {'User-Agent': 'TaigaLauncher'}, redirect: 'follow', signal: AbortSignal.timeout(30 * 60000)});
 if (!res.ok || !res.body) throw Error('Download da atualização falhou (HTTP ' + res.status + ').');
 const out = fs.createWriteStream(part); let got = 0;
 try { for await (const chunk of res.body) { got += chunk.length; if (!out.write(chunk)) await new Promise(r => out.once('drain', r)); onProgress(got, rel.size); } } finally { await new Promise(r => out.end(r)); }
 if (rel.size && got !== rel.size) { try { fs.rmSync(part); } catch {} throw Error('Download da atualização incompleto.'); }
 const head = Buffer.alloc(4); const fd = fs.openSync(part, 'r'); fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
 if (head.readUInt32LE(0) !== 0x04034b50) { try { fs.rmSync(part); } catch {} throw Error('O arquivo baixado não é um .zip válido.'); }
 // O GitHub publica o SHA-256 de cada arquivo da Release: o pacote baixado precisa bater com ele.
 if (rel.sha256) { const h = crypto.createHash('sha256').update(fs.readFileSync(part)).digest('hex'); if (h !== rel.sha256) { try { fs.rmSync(part); } catch {} throw Error('A atualização baixada não confere com a publicada no GitHub.'); } }
 fs.renameSync(part, file);
 return file;
}

// Script que aplica a atualização depois que o programa fecha.
// - espera o programa e todos os processos dele (GPU, ajudantes) saírem da pasta, para nenhum arquivo ficar preso;
// - pasta protegida (ex.: Arquivos de Programas): pede permissão de administrador uma vez e copia de novo;
// - grava o resultado em resultFile, para o programa avisar na próxima abertura se algo falhou.
export function updateScript({zip, installDir, pid, exeName = 'Taiga Launcher.exe', resultFile = '', version = ''}) {
 const q = s => "'" + String(s).replace(/'/g, "''") + "'";
 return `$ErrorActionPreference = 'Stop'
$zip = ${q(zip)}; $dest = ${q(installDir)}; $procId = ${Number(pid) || 0}; $result = ${q(resultFile)}; $version = ${q(version)}
$log = Join-Path $env:TEMP 'taiga-launcher-update.log'
function Note($m) { Add-Content -Path $log -Value ("$(Get-Date -Format s) $m") }
function Result($ok, $msg) { if ($result) { try { $o = @{ ok = $ok; version = $version; error = [string]$msg; at = (Get-Date -Format s) } | ConvertTo-Json -Compress; [IO.File]::WriteAllText($result, $o, (New-Object System.Text.UTF8Encoding($false))) } catch {} } }
try {
  if ($procId -gt 0) { try { Wait-Process -Id $procId -Timeout 60 -ErrorAction SilentlyContinue } catch {} }
  # Processos ajudantes do programa (mesma pasta) ainda abertos: espera até 30 s e encerra os que sobrarem.
  for ($i = 0; $i -lt 30; $i++) { $left = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($dest, [StringComparison]::OrdinalIgnoreCase) }); if (-not $left.Count) { break }; Start-Sleep -Seconds 1 }
  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($dest, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  $tmp = Join-Path $env:TEMP ('taiga-launcher-update-' + [guid]::NewGuid().ToString('N'))
  Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
  $src = Join-Path $tmp 'Taiga Launcher'; if (-not (Test-Path -LiteralPath $src)) { $src = $tmp }
  robocopy $src $dest /E /XF chaves.json /R:10 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null
  $code = $LASTEXITCODE
  if ($code -ge 8) {
    Note "robocopy sem permissão ($code); tentando como administrador"
    $cmdArgs = '/c robocopy "' + $src + '" "' + $dest + '" /E /XF chaves.json /R:10 /W:2 /NFL /NDL /NJH /NJS /NP'
    try { $p = Start-Process -FilePath 'cmd.exe' -ArgumentList $cmdArgs -Verb RunAs -Wait -PassThru -WindowStyle Hidden; $code = $p.ExitCode } catch { $code = 16 }
  }
  if ($code -ge 8) { throw "não foi possível copiar os arquivos novos (robocopy $code)" }
  $new = Join-Path $dest ${q(exeName)}; $old = Join-Path $dest 'TaigaPSP.exe'
  if ((Test-Path -LiteralPath $new) -and (Test-Path -LiteralPath $old)) { Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
  Note "Atualizado a partir de $zip"
  Result $true ''
  Start-Process -FilePath $new
} catch {
  Note ("Falhou: " + $_)
  Result $false $_
  $exe = Join-Path $dest ${q(exeName)}; if (-not (Test-Path -LiteralPath $exe)) { $exe = Join-Path $dest 'TaigaPSP.exe' }
  if (Test-Path -LiteralPath $exe) { Start-Process -FilePath $exe }
}
`;
}

