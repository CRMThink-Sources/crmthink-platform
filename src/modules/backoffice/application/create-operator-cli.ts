import { parseArgs } from 'node:util'
import { emailSchema, roleSchema } from '../domain/operator'
import type { OperatorService } from './operators'

const USAGE = `Uso (no servidor: node dist/src/cli/create-operator.js no lugar de yarn admin:create-operator):
  yarn admin:create-operator --email <e-mail> --name "<nome>" --role <viewer|operator>
  yarn admin:create-operator --email <e-mail> --reset`

/**
 * `yarn admin:create-operator`: cria uma conta (o primeiro operador nasce aqui) ou, com
 * `--reset`, gera senha provisória e TOTP novos para quem perdeu o acesso. Senha e URI
 * só aparecem nesta saída.
 */
export async function runCreateOperator(
  argv: string[],
  operators: OperatorService,
  print: (line: string) => void,
): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string' },
      reset: { type: 'boolean', default: false },
    },
    strict: true,
  })
  if (!values.email) throw new Error(`--email é obrigatório\n${USAGE}`)
  const email = emailSchema.parse(values.email)

  let issued
  if (values.reset) {
    const existing = (await operators.list()).find(o => o.email === email)
    if (!existing) throw new Error(`Operador ${email} não encontrado`)
    issued = await operators.resetAccess(existing.id)
  } else {
    if (!values.name || !values.role) {
      throw new Error(`--name e --role são obrigatórios\n${USAGE}`)
    }
    issued = await operators.create({
      email,
      name: values.name,
      role: roleSchema.parse(values.role),
    })
  }

  print(
    `${values.reset ? 'Acesso redefinido' : 'Operador criado'}: ${issued.operator.email} (${issued.operator.role})`,
  )
  print(
    `Senha provisória (troca obrigatória no 1º login): ${issued.temporaryPassword}`,
  )
  print(`TOTP (cadastre no app autenticador): ${issued.totpUri}`)
  print('Estes valores não serão exibidos de novo.')
}
