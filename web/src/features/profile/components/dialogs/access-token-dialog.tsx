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
import { Refresh01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

import { useAccessToken } from '../../hooks'

// ============================================================================
// Access Token Dialog Component
// ============================================================================

interface AccessTokenDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AccessTokenDialog({
  open,
  onOpenChange,
}: AccessTokenDialogProps) {
  const { t } = useTranslation()
  const { token, loading, generating, load, generate } = useAccessToken()

  // Load the existing token when the dialog opens without rotating it
  useEffect(() => {
    if (open && !token) {
      load()
    }
  }, [open, token, load])

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Access Token')}
      description={t(
        "Your system access token for API authentication. Keep it secure and don't share it with others."
      )}
      contentClassName='sm:max-w-md'
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            {t('Close')}
          </Button>
          <Button
            type='button'
            onClick={generate}
            disabled={loading || generating}
          >
            {generating ? (
              <Spinner data-icon='inline-start' />
            ) : (
              <HugeiconsIcon icon={Refresh01Icon} data-icon='inline-start' />
            )}
            {generating ? t('Generating...') : t('Regenerate')}
          </Button>
        </>
      }
    >
      <div className='my-6 space-y-4'>
        <div className='space-y-2'>
          <Label htmlFor='token'>{t('Token')}</Label>
          <div className='flex gap-2'>
            <Input
              id='token'
              type='text'
              value={token}
              readOnly
              className='font-mono text-xs'
              placeholder={
                loading
                  ? t('Loading...')
                  : t('Click "Generate" to create a token')
              }
            />
            <CopyButton
              value={token}
              variant='outline'
              className='size-9'
              iconClassName='size-4'
              tooltip={t('Copy token')}
              aria-label={t('Copy token')}
            />
          </div>
          <p className='text-muted-foreground text-xs'>
            {t('Use this token for API authentication')}
          </p>
        </div>
      </div>
    </Dialog>
  )
}
