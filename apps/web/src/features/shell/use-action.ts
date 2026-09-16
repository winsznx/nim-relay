import { useMutation } from '@tanstack/react-query'
import { playerMessage } from './errors'
import { showToast } from './toast'

export interface Action {
  run(task: () => Promise<unknown>): void
  pending: boolean
}

/**
 * One in-flight task at a time with player-facing failure copy. Screens use it
 * for buttons whose result is visible in refreshed data or navigation.
 */
export function useAction(): Action {
  const mutation = useMutation<unknown, unknown, () => Promise<unknown>>({
    mutationFn: task => task(),
    onError: error => {
      const message = playerMessage(error)
      if (message) showToast(message, 'error')
    },
  })
  return {
    run(task) {
      if (!mutation.isPending) mutation.mutate(task)
    },
    pending: mutation.isPending,
  }
}
