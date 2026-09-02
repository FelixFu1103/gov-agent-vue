import { spawn } from 'node:child_process'

const commands = [
  spawn(process.execPath, ['--env-file-if-exists=.env', '--watch', 'server/index.js'], { stdio: 'inherit', env: process.env }),
  spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev:web'], { stdio: 'inherit', env: process.env })
]

function stop(signal = 'SIGTERM') {
  for (const child of commands) child.kill(signal)
}

for (const child of commands) {
  child.on('exit', code => {
    if (code && code !== 0) {
      stop()
      process.exitCode = code
    }
  })
}

process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
