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
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { hasPermission } from '@/lib/admin-permissions'
import { useAuthStore } from '@/stores/auth-store'

import { getPersonalChannels } from './api'
import { ReviewForm } from './components/review-form'
import type { PersonalChannel } from './types'

export function PersonalChannelReviews() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<PersonalChannel | null>(null)
  const canReview = useAuthStore((state) =>
    hasPermission(state.auth.user, 'channel', 'sensitive_write')
  )
  const reviews = useQuery({
    queryKey: ['personal-channel-reviews', page],
    queryFn: () => getPersonalChannels(page, true),
  })
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Channel Reviews')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex flex-col gap-4'>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Review the submitted version before publishing. Later edits require a new review.'
            )}
          </p>
          {reviews.isPending && <Skeleton className='h-24 w-full' />}
          {reviews.error && (
            <div role='alert'>
              <p>{reviews.error.message}</p>
              <Button variant='outline' onClick={() => void reviews.refetch()}>
                {t('Retry')}
              </Button>
            </div>
          )}
          {reviews.data?.items.length === 0 && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t('No channels awaiting review')}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
          {!!reviews.data?.items.length && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Name')}</TableHead>
                  <TableHead>{t('Group')}</TableHead>
                  <TableHead>{t('User ID')}</TableHead>
                  <TableHead>{t('Actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviews.data.items.map((channel) => (
                  <TableRow key={channel.id}>
                    <TableCell>{channel.config.name}</TableCell>
                    <TableCell>{channel.group_name}</TableCell>
                    <TableCell>{channel.owner_user_id}</TableCell>
                    <TableCell>
                      <Button
                        variant='outline'
                        onClick={() => setSelected(channel)}
                      >
                        {t('Review')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className='flex items-center justify-end gap-3'>
            <Button
              variant='outline'
              disabled={page === 1 || reviews.isFetching}
              onClick={() => setPage((value) => value - 1)}
            >
              {t('Previous')}
            </Button>
            <span>{page}</span>
            <Button
              variant='outline'
              disabled={
                !reviews.data ||
                page * 20 >= reviews.data.total ||
                reviews.isFetching
              }
              onClick={() => setPage((value) => value + 1)}
            >
              {t('Next')}
            </Button>
          </div>
        </div>
        <Dialog
          open={!!selected}
          onOpenChange={(open) => {
            if (!open) setSelected(null)
          }}
        >
          <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-3xl'>
            <DialogHeader>
              <DialogTitle>{t('Channel Review')}</DialogTitle>
              <DialogDescription>
                {t('Only this submitted revision will be published.')}
              </DialogDescription>
            </DialogHeader>
            {selected && (
              <ReviewForm
                key={selected.revision.id}
                channel={selected}
                canReview={canReview}
                onSaved={() => setSelected(null)}
              />
            )}
          </DialogContent>
        </Dialog>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
