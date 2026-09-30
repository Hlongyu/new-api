/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

export function RebuildRecap(props: {
  userId: number
  month: string
  name: string
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const rebuild = useMutation({
    mutationFn: async () => {
      const response = await api.post<{ success: boolean; message?: string }>(
        '/api/data/monthly-recap/rebuild',
        null,
        { params: { user_id: props.userId, month: props.month } }
      )
      if (!response.data.success) {
        throw new Error(response.data.message || 'Rebuild failed')
      }
    },
    onSuccess: async () => {
      setOpen(false)
      await client.invalidateQueries({ queryKey: ['monthly-recap'] })
    },
  })
  return (
    <>
      <Button
        variant='outline'
        className='ms-3'
        disabled={rebuild.isPending}
        onClick={() => {
          rebuild.reset()
          setOpen(true)
        }}
      >
        {t('Recalculate recap')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(value) => {
          if (!rebuild.isPending) setOpen(value)
        }}
        title={t('Recalculate recap')}
        desc={t(
          'Replace the saved recap for {{name}} in {{month}} using retained logs? Deleted logs cannot be recovered.',
          { name: props.name, month: props.month }
        )}
        confirmText={t('Recalculate recap')}
        isLoading={rebuild.isPending}
        handleConfirm={() => rebuild.mutate()}
      >
        {rebuild.isError && (
          <p role='alert'>
            {t('Could not recalculate the recap. Please try again.')}
          </p>
        )}
      </ConfirmDialog>
    </>
  )
}
